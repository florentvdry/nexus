// Pilotage de l'application de bureau en développement, via le débogage distant de WebView2 (Chrome DevTools Protocol).
// Aucune dépendance : Node 22+ fournit WebSocket. Lancer l'application avec `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
// "--remote-debugging-port=9222" pnpm tauri dev`, puis `node e2e/run.mjs`.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DEBUG_PORT = Number(process.env.NEXUS_DEBUG_PORT ?? 9222);

async function listPages() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
  return (await response.json()).filter((item) => item.type === "page");
}

/** Une connexion à une fenêtre : envoi de commandes CDP, réponses et événements. */
function openPage(url) {
  const socket = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const events = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    } else {
      events.push(data);
    }
  };
  const ready = new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  // Une réponse qui ne vient jamais ne doit pas bloquer le parcours : délai de 60 s par commande.
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`pas de réponse CDP à ${method} après 60 s`));
      }, 60_000);
      pending.set(id, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { ready, send, events, close: () => socket.close() };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class NexusApp {
  constructor() {
    this.main = null;
    this.confirm = null;
    this.results = [];
  }

  /** Attache les deux fenêtres ; l'application doit déjà tourner. */
  async connect() {
    const pages = await listPages();
    const main = pages.find((item) => item.title === "NEXUS");
    if (!main) throw new Error("fenêtre principale introuvable : l'application tourne-t-elle ?");
    this.main = openPage(main.webSocketDebuggerUrl);
    await this.main.ready;
    await this.main.send("Runtime.enable");
    await this.main.send("Page.enable");
    // Les demandes d'autorisation s'affichent dans l'interface principale : elle sert aussi de fenêtre de confirmation.
    this.confirm = this.main;
  }

  close() {
    this.main?.close();
  }

  async evaluate(page, expression) {
    const response = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.result?.exceptionDetails) throw new Error(`JavaScript : ${JSON.stringify(response.result.exceptionDetails.text)}`);
    return response.result?.result?.value;
  }

  /** Texte visible de la fenêtre principale. */
  async text(page = this.main) {
    return this.evaluate(page, "document.body.innerText");
  }

  /** Attend qu'un texte (regex) apparaisse dans la fenêtre. Renvoie le texte trouvé, ou lève une erreur au délai. */
  async waitForText(pattern, { page = this.main, timeout = 60_000 } = {}) {
    const started = Date.now();
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
    while (Date.now() - started < timeout) {
      const text = await this.text(page);
      if (regex.test(text)) return text;
      await sleep(500);
    }
    throw new Error(`texte absent après ${timeout} ms : ${pattern}`);
  }

  /** Nombre de réponses de l'assistant dans la conversation. */
  /** Nombre de réponses de l'assistant : la scène l'expose dans data-count. */
  async assistantCount() {
    return (await this.evaluate(this.main, "Number(document.querySelector('[data-count]')?.dataset.count ?? 0)")) ?? 0;
  }

  /** Envoie une demande comme le ferait l'utilisateur : saisie, puis Entrée. Attend la réponse. */
  async ask(text, { timeout = 120_000 } = {}) {
    const before = await this.assistantCount();
    await this.evaluate(this.main, "document.querySelector('form.command input').focus()");
    await this.main.send("Input.insertText", { text });
    await this.main.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await this.main.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if ((await this.assistantCount()) > before) break;
      await sleep(400);
    }
    await sleep(1200);
    const answers = await this.lastAnswers(before);
    this.lastAnswer = answers.join(" | ");
    return answers;
  }

  /** Réponse affichée par la scène, si elle est postérieure à `since` (le fil n'existe plus : seule la dernière réponse est visible). */
  async lastAnswers(since = 0) {
    const count = await this.assistantCount();
    if (count <= since) return [];
    const text = await this.evaluate(this.main, "document.querySelector('[data-answer]')?.innerText ?? ''");
    return text ? [text] : [];
  }

  /** Clique sur le premier bouton dont le libellé correspond, dans la fenêtre donnée. */
  async clickButton(label, page = this.main) {
    const clicked = await this.evaluate(
      page,
      `(() => { const wanted = ${JSON.stringify(label)}; const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === wanted || x.getAttribute('aria-label') === wanted); if (!b) return false; b.click(); return true; })()`,
    );
    if (!clicked) throw new Error(`bouton introuvable : ${label}`);
    return clicked;
  }

  /** Attend une demande de confirmation dans le cadre d'autorisation, et renvoie son texte. */
  async waitForConfirmation(pattern = /Autoriser|Refuser/, timeout = 60_000) {
    if (!this.confirm) throw new Error("fenêtre de confirmation non attachée");
    return this.waitForText(pattern, { page: this.confirm, timeout });
  }

  /** Capture d'écran d'une fenêtre, enregistrée en PNG. */
  async screenshot(file, page = this.main) {
    await sleep(600);
    const response = await page.send("Page.captureScreenshot", { format: "png" });
    if (!response.result?.data) throw new Error("capture impossible");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(response.result.data, "base64"));
    return file;
  }

  /** Enregistre le résultat d'une vérification, pour le rapport final. */
  record(name, ok, detail = "") {
    this.results.push({ name, ok, detail: String(detail).slice(0, 600) });
    console.log(`${ok ? "OK  " : "ECHEC"} ${name}${detail ? ` — ${String(detail).slice(0, 160).replace(/\n/g, " ")}` : ""}`);
  }
}

export { sleep };
