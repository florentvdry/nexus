// Parcours de bout en bout de NEXUS, sur l'application de bureau réelle (tauri dev, débogage distant WebView2).
// Usage : lancer l'application avec WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222", puis
//   node e2e/run.mjs            (tout)
//   node e2e/run.mjs setup      (un seul parcours, par son nom)
// Les captures vont dans docs/screenshots/ ; le rapport dans e2e/results.json et docs/screenshots/RESULTS.md.
// Ce script modifie les données de l'application : une sauvegarde préalable est à faire (voir docs/TESTING.md).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NexusApp, sleep } from "./lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "docs", "screenshots");
const DOCS = join(process.env.USERPROFILE, "Documents");
const SCRATCH = process.env.NEXUS_E2E_SCRATCH ?? join(process.env.TEMP, "nexus-e2e");
mkdirSync(SCRATCH, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const shot = (app, name, page) => app.screenshot(join(SHOTS, `${name}.png`), page);
const tasklist = (image) => execFileSync("tasklist", ["/FI", `IMAGENAME eq ${image}`], { encoding: "utf8" }).toLowerCase();

/** Une réponse compte comme comprise si NEXUS a répondu quelque chose d'autre que son refus de comprendre. */
const understood = (answer) => answer.length > 0 && !/Je n'ai pas compris|pas compris|didn't understand/i.test(answer.join(" "));

/** Une étape qui échoue ne doit pas arrêter le parcours : elle est notée, avec une capture de l'état. */
async function step(app, name, body) {
  try {
    await body();
  } catch (error) {
    app.record(name, false, error.message);
    await shot(app, `erreur-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`).catch(() => {});
  }
}

/** Répond à la prochaine demande de confirmation, dans la fenêtre dédiée. */
async function answerConfirmation(app, approve) {
  const text = await app.waitForConfirmation();
  await app.clickButton(approve ? "Autoriser" : "Refuser", app.confirm);
  await sleep(1500);
  return text;
}

const scenarios = {
  async setup(app) {
    await step(app, "premier lancement : réinitialisation des indicateurs", async () => {
      await app.evaluate(app.main, "localStorage.removeItem('nexus.modelSetup.seen'); localStorage.removeItem('nexus.firstConversation.done'); true");
      await app.main.send("Page.reload");
      await sleep(5000);
      await app.waitForText("Bienvenue sur NEXUS");
      app.record("premier lancement : écran de bienvenue", true);
      await shot(app, "01-premier-lancement-profil");
    });
    await step(app, "premier lancement : choix du mode", async () => {
      await app.clickButton("Continuer");
      await app.waitForText("Comment voulez-vous utiliser NEXUS");
      await shot(app, "02-premier-lancement-mode");
      app.record("premier lancement : choix du mode affiché", true);
    });
    await step(app, "premier lancement : installation du modèle", async () => {
      await app.clickButton("Installer");
      await app.waitForText("Modèle prêt", { timeout: 600_000 });
      const text = await app.text();
      app.record("premier lancement : modèle installé et testé", true, text.match(/Modèle prêt[^\n]*/)?.[0]);
      await shot(app, "03-premier-lancement-modele-pret");
      await app.clickButton("Commencer");
    });
  },

  async conversation(app) {
    await step(app, "première conversation : questions de profil", async () => {
      // Réponse choisie d'après la question posée : la conversation avance question par question.
      const reply = (question) => {
        const q = question.toLowerCase();
        if (/tutoie|vouvoie|tutoiement|vouvoiement/.test(q)) return "tutoiement";
        if (/appelle|prénom|prenom|nom/.test(q)) return "Ana";
        if (/habites|ville|où|ou vis/.test(q)) return "Lyon";
        if (/activité|travail|métier|fais dans la vie/.test(q)) return "développeuse";
        if (/utilis|usage|pour quoi|servir/.test(q)) return "organiser mes fichiers et mes rendez-vous";
        if (/longueur|courte|longue|réponses/.test(q)) return "réponses courtes";
        if (/limite|interdi|ne pas|jamais/.test(q)) return "ne touche jamais à mes fichiers sans me demander";
        return "oui";
      };
      let answered = 0;
      let question = (await app.lastAnswers(0)).slice(-1)[0] ?? "";
      for (let turn = 0; turn < 12 && /\?/.test(question); turn += 1) {
        const all = await app.ask(reply(question), { timeout: 90_000 });
        answered += 1;
        // Chaque question peut arriver après l'accusé de réception : on attend la suivante avant de conclure.
        await sleep(2500);
        question = (await app.lastAnswers(0)).slice(-1)[0] ?? all.slice(-1)[0] ?? "";
      }
      app.record("première conversation : questions répondues", answered >= 6, `${answered} réponses`);
      await shot(app, "04-premiere-conversation");
    });

    await step(app, "conversation : nouvelle conversation", async () => {
      await app.clickButton("Conversation").catch(() => {});
      await sleep(600);
      await app.clickButton("Nouvelle conversation");
      await sleep(800);
      app.record("conversation : nouvelle conversation vide", (await app.assistantCount()) === 0);
    });

    await step(app, "conversation : bonjour et aide", async () => {
      const answer = await app.ask("bonjour");
      app.record("conversation : salutation", answer.length > 0, answer[0]);
      await shot(app, "05-conversation-salutation");
    });

    await step(app, "conversation : heure et date", async () => {
      const answer = await app.ask("Quelle heure est-il ?");
      app.record("conversation : heure", /\d{1,2}:\d{2}/.test(answer.join(" ")), answer.join(" | "));
    });

    await step(app, "conversation : demande incomprise", async () => {
      const answer = await app.ask("zzqx blorp vrombi");
      app.record("conversation : demande incomprise, sans invention", answer.length > 0, answer.join(" | "));
      await shot(app, "06-conversation-incomprise");
    });

    await step(app, "conversation : anglais", async () => {
      await app.clickButton("EN");
      await sleep(800);
      const answer = await app.ask("What time is it?");
      app.record("conversation : réponse en anglais", /\d{1,2}:\d{2}|time|o'clock|PM|AM/i.test(answer.join(" ")), answer.join(" | "));
      await shot(app, "07-conversation-anglais");
      await app.clickButton("FR");
      await sleep(800);
    });
  },

  async system(app) {
    await step(app, "système : ressources de l'ordinateur", async () => {
      const answer = await app.ask("Affiche les informations de mon ordinateur");
      app.record("système : informations", /Processeur|Mémoire/i.test(answer.join(" ")), answer.join(" | "));
      await shot(app, "08-systeme-informations");
    });
    await step(app, "système : processus", async () => {
      const answer = await app.ask("Quelles applications sont ouvertes ?");
      app.record("processus : liste", understood(answer), answer.join(" | ").slice(0, 200));
      await shot(app, "09-processus");
    });
  },

  async applications(app) {
    await step(app, "applications : lancer le Bloc-notes", async () => {
      await app.ask("Lance le Bloc-notes");
      // Le Bloc-notes met parfois plusieurs secondes à apparaître : on attend au plus 15 s.
      let running = false;
      for (let attempt = 0; attempt < 30 && !running; attempt += 1) {
        await sleep(500);
        running = tasklist("notepad.exe").includes("notepad.exe");
      }
      app.record("applications : Bloc-notes lancé (vérifié dans le système)", running);
    });
    await step(app, "fenêtres : liste", async () => {
      const answer = await app.ask("Liste mes fenêtres");
      app.record("fenêtres : liste", understood(answer), answer.join(" | ").slice(0, 200));
      await shot(app, "10-fenetres-liste");
    });
    await step(app, "fenêtres : fermer le Bloc-notes, après accord", async () => {
      await app.ask("Ferme la fenêtre du Bloc-notes");
      const text = await answerConfirmation(app, true);
      await shot(app, "11-confirmation-fermer-fenetre", app.confirm);
      await sleep(1500);
      app.record("fenêtres : confirmation affichée dans la fenêtre dédiée", /Autoriser/.test(text), text.slice(0, 160));
      app.record("fenêtres : Bloc-notes fermé après accord", !tasklist("notepad.exe").includes("notepad.exe"));
    });
  },

  async files(app) {
    const a = join(DOCS, "nexus-e2e-a.txt");
    const b = join(DOCS, "nexus-e2e-b.txt");
    const renamed = join(DOCS, "nexus-e2e-renomme.txt");
    await step(app, "fichiers : fichiers de test", async () => {
      writeFileSync(a, "test NEXUS, à renommer\n");
      writeFileSync(b, "test NEXUS, à refuser de supprimer\n");
      app.record("fichiers : fichiers de test créés dans Documents", existsSync(a) && existsSync(b));
    });
    await step(app, "fichiers : recherche", async () => {
      const answer = await app.ask("Cherche mes fichiers txt dans mes documents");
      app.record("fichiers : recherche", understood(answer), answer.join(" | ").slice(0, 200));
      await shot(app, "12-recherche-fichiers");
    });
    await step(app, "fichiers : renommer après accord", async () => {
      await app.ask("Renomme nexus-e2e-a.txt en nexus-e2e-renomme.txt");
      await answerConfirmation(app, true);
      await sleep(1500);
      app.record("fichiers : renommage effectué après accord", existsSync(renamed) && !existsSync(a));
    });
    await step(app, "fichiers : suppression refusée", async () => {
      await app.ask("Supprime nexus-e2e-b.txt");
      await answerConfirmation(app, false);
      await shot(app, "13-confirmation-suppression-refusee", app.confirm).catch(() => {});
      await sleep(1000);
      app.record("fichiers : suppression refusée, fichier conservé", existsSync(b));
    });
    await step(app, "fichiers : nettoyage", async () => {
      if (existsSync(renamed)) unlinkSync(renamed);
      if (existsSync(b)) unlinkSync(b);
    });
  },

  async agenda(app) {
    await step(app, "agenda : rendez-vous du jour", async () => {
      const ics = join(SCRATCH, "agenda-test.ics");
      const now = new Date();
      const pad = (value) => String(value).padStart(2, "0");
      const stamp = (hour) => `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(hour)}0000`;
      writeFileSync(
        ics,
        ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `DTSTART:${stamp(10)}`, `DTEND:${stamp(11)}`, "SUMMARY:Revue de projet", "END:VEVENT", "END:VCALENDAR"].join("\r\n"),
      );
      await app.evaluate(app.main, `localStorage.setItem('nexus.agenda.path', ${JSON.stringify(ics)}); true`);
      const answer = await app.ask("Qu'est-ce que j'ai aujourd'hui ?");
      app.record("agenda : rendez-vous du jour lu", /Revue de projet/.test(answer.join(" ")) || /Revue de projet/.test(await app.text()), answer.join(" | ").slice(0, 200));
      await shot(app, "14-agenda");
    });
    await step(app, "messages : brouillon, rien n'est envoyé", async () => {
      const answer = await app.ask("écris à Alice que je suis en retard");
      app.record("messages : brouillon proposé", understood(answer), answer.join(" | ").slice(0, 200));
      await shot(app, "15-message-brouillon");
    });
  },

  async memory(app) {
    await step(app, "mémoire : enregistrer", async () => {
      const answer = await app.ask("retiens que je préfère Firefox");
      app.record("mémoire : préférence retenue", understood(answer), answer.join(" | ").slice(0, 160));
    });
    await step(app, "mémoire : réglages", async () => {
      await app.clickButton("Réglages", app.main);
      await sleep(800);
      await app.clickButton("Mémoire", app.main);
      await app.waitForText("Firefox");
      app.record("mémoire : préférence visible dans les réglages", true);
      await shot(app, "16-reglages-memoire");
    });
    await step(app, "mémoire : oublier", async () => {
      await app.clickButton("Accueil", app.main).catch(() => {});
      await app.clickButton("Conversation", app.main).catch(() => {});
      await sleep(600);
      const answer = await app.ask("oublie Firefox");
      app.record("mémoire : oubli demandé", understood(answer), answer.join(" | ").slice(0, 160));
    });
  },

  async schedule(app) {
    await step(app, "planification : rappel pour demain", async () => {
      const answer = await app.ask("Rappelle-moi demain à 9 h de sortir les poubelles");
      app.record("planification : rappel créé", understood(answer) && /9|poubelle|demain/i.test(answer.join(" ")), answer.join(" | ").slice(0, 200));
      await app.clickButton("Planning", app.main).catch(() => app.clickButton("Ouvrir le planning", app.main).catch(() => {}));
      await sleep(800);
      await shot(app, "17-planning");
    });
  },

  async web(app) {
    await step(app, "web : fiche sujet", async () => {
      const answer = await app.ask("Qui est Ada Lovelace ?", { timeout: 120_000 });
      app.record("web : fiche Wikipédia", understood(answer), answer.join(" | ").slice(0, 200));
      await shot(app, "18-fiche-sujet");
    });
    await step(app, "web : photo", async () => {
      await app.ask("Montre une photo de la tour Eiffel", { timeout: 120_000 });
      await sleep(2000);
      const text = await app.text();
      app.record("web : photo avec son auteur et sa licence", /Wikimedia|licence|CC|Auteur|Photo/i.test(text));
      await shot(app, "19-photo");
    });
    await step(app, "web : actualités", async () => {
      await app.ask("Quelles sont les actus ?", { timeout: 120_000 });
      await sleep(2000);
      await shot(app, "20-actualites");
      app.record("web : actualités", true);
    });
    await step(app, "web : recherche", async () => {
      const answer = await app.ask("Recherche sur le web : Rust async", { timeout: 120_000 });
      app.record("web : recherche avec sources", understood(answer), answer.join(" | ").slice(0, 200));
      await shot(app, "21-recherche-web");
    });
  },

  async screen(app) {
    await step(app, "écran : lecture après accord", async () => {
      await app.ask("Qu'est-ce qui est affiché à l'écran ?");
      await answerConfirmation(app, true);
      await shot(app, "22-confirmation-ecran", app.confirm).catch(() => {});
      await sleep(1000);
      const answer = await app.waitForText(/\w{4,}/, { timeout: 120_000 }).catch(() => "");
      app.record("écran : réponse du modèle de vision", understood(answer));
      await shot(app, "23-ecran-lu");
    });
  },

  async osint(app) {
    await step(app, "OSINT : analyse d'un domaine", async () => {
      const answer = await app.ask("Analyse example.com", { timeout: 180_000 });
      app.record("OSINT : rapport sur un domaine", understood(answer), answer.join(" | ").slice(0, 200));
      await shot(app, "24-osint-domaine");
    });
  },

  async connectors(app) {
    await step(app, "connecteurs : demande sans connecteur installé", async () => {
      const answer = await app.ask("Envoie un message Discord à Anthony", { timeout: 120_000 });
      app.record("connecteurs : proposition de connecteur", understood(answer), answer.join(" | ").slice(0, 200));
      await shot(app, "25-connecteur-propose");
    });
  },

  async plugins(app) {
    await step(app, "plugins : liste", async () => {
      const answer = await app.ask("liste mes plugins");
      app.record("plugins : liste", understood(answer), answer.join(" | ").slice(0, 200));
      await shot(app, "26-plugins");
    });
    await step(app, "plugins : convertisseur (WebAssembly)", async () => {
      const answer = await app.ask("convertis 12 km en miles");
      app.record("plugins : conversion par le plugin", /mi/.test(answer.join(" ")), answer.join(" | ").slice(0, 200));
    });
  },

  async settings(app) {
    const panes = [
      ["Général", "27-reglages-general"],
      ["Modèle et performances", "28-reglages-modele"],
      ["Voix et lecture", "29-reglages-voix"],
      ["Autorisations", "30-reglages-autorisations"],
      ["Journal", "31-reglages-journal"],
      ["Accessibilité", "32-reglages-accessibilite"],
      ["Démarrage", "33-reglages-demarrage"],
      ["Agenda", "34-reglages-agenda"],
      ["Service en ligne", "35-reglages-nvidia"],
      ["Diagnostic", "36-reglages-diagnostic"],
    ];
    await step(app, "réglages : ouverture", async () => {
      await app.clickButton("Réglages", app.main);
      await sleep(800);
    });
    for (const [label, file] of panes) {
      await step(app, `réglages : ${label}`, async () => {
        await app.clickButton(label, app.main);
        await sleep(900);
        await shot(app, file);
        app.record(`réglages : volet « ${label} »`, true);
      });
    }
  },
};

async function main() {
  const only = process.argv[2];
  const app = new NexusApp();
  await app.connect();
  const order = ["setup", "conversation", "system", "applications", "files", "agenda", "memory", "schedule", "web", "screen", "osint", "connectors", "plugins", "settings"];
  for (const name of only ? [only] : order) {
    console.log(`
== ${name} ==`);
    // Chaque parcours part de l'accueil : un réglage laissé ouvert ne doit pas fausser le suivant.
    if (name !== "setup") await app.clickButton("Accueil").catch(() => {});
    await sleep(600);
    await scenarios[name](app);
  }
  app.close();
  const file = join(ROOT, "e2e", "results.json");
  writeFileSync(file, JSON.stringify(app.results, null, 2));
  const ok = app.results.filter((item) => item.ok).length;
  console.log(`\n${ok}/${app.results.length} vérifications réussies. Rapport : ${file}`);
}

main().catch((error) => {
  console.error("ÉCHEC :", error);
  process.exit(1);
});
