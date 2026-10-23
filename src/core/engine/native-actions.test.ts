import { describe, expect, it, vi } from "vitest";

import { NativeCallError, type NativeAdapter } from "../native/adapter";
import type { AgentEvent, ConfirmationRequest, NativeBridge } from "../native/bridge";
import { createEngine, type EngineEvent } from "./engine";

// Pont natif SIMULÉ : réponses fixes, sans toucher au disque, aux processus ni au CLI réel.
function fakeBridge(overrides: Partial<NativeBridge> = {}) {
  const agentListeners = new Set<(runId: string, event: AgentEvent) => void>();
  const confirmationListeners = new Set<(request: ConfirmationRequest) => void>();
  const bridge: NativeBridge & {
    emitAgent(runId: string, event: AgentEvent): void;
    emitConfirmation(request: ConfirmationRequest): void;
  } = {
    forPlugin: () => bridge,
    pluginPrepare: vi.fn(async (source: string) => ({
      stagingId: "stage-1-0",
      id: "community.ana.verbes",
      name: "Verbes",
      version: "1.0.0",
      author: "Ana",
      description: "Vocabulaire",
      kinds: ["language"],
      source,
      commit: null,
      digest: "sha256:abc",
    })),
    pluginInstall: vi.fn(async () => ({
      id: "community.ana.verbes",
      name: "Verbes",
      version: "1.0.0",
      source: "https://example.org/ana/verbes.git",
      commit: null,
      digest: "sha256:abc",
      state: "active" as const,
      problems: [],
    })),
    pluginRemove: vi.fn(async () => {}),
    pluginList: vi.fn(async () => []),
    pluginPacks: vi.fn(async () => []),
    pluginRun: vi.fn(async () => ({ caption: "ok", table: null })),
    pluginIndex: vi.fn(async () => [
      { id: "community.ana.verbes", name: "Verbes", version: "1.0.0", description: "Vocabulaire", source: "https://example.org/ana/verbes.git", kinds: ["language"] },
    ]),
    journalStatus: vi.fn(async () => false),
    setJournalEnabled: vi.fn(async () => {}),
    recordJournal: vi.fn(async () => false),
    listJournal: vi.fn(async () => []),
    clearJournal: vi.fn(async () => {}),
    listWindows: vi.fn(async () => [
      { id: 101, title: "Document1 - Word", process: "WINWORD.EXE", pid: 900 },
      { id: 102, title: "Facture - Navigateur", process: "chrome.exe", pid: 901 },
    ]),
    focusWindow: vi.fn(async () => {}),
    closeWindow: vi.fn(async () => {}),
    listProcesses: vi.fn(async () => [{ name: "Discord.exe", pid: 4242, cpuPercent: 3, memoryBytes: 512 * 1024 * 1024 }]),
    searchFiles: vi.fn(async () => [
      { path: "/home/ana/Téléchargements/contrat.pdf", name: "contrat.pdf", size: 2048, modified: 1_780_000_000 },
      { path: "/home/ana/Téléchargements/facture.pdf", name: "facture.pdf", size: 4096, modified: 1_780_000_100 },
    ]),
    operateFile: vi.fn(async (operation) => (operation.kind === "trash" ? operation.path : "/home/ana/Archives/a.pdf")),
    detectAgent: vi.fn(async () => ({ path: "/usr/bin/claude", version: "2.1.309" })),
    runAgent: vi.fn(async () => {}),
    cancelAgent: vi.fn(async () => true),
    onAgentEvent: (listener) => {
      agentListeners.add(listener);
      return () => agentListeners.delete(listener);
    },
    onConfirmationRequest: (listener) => {
      confirmationListeners.add(listener);
      return () => confirmationListeners.delete(listener);
    },
    answerConfirmation: vi.fn(async () => {}),
    emitAgent(runId, event) {
      for (const listener of agentListeners) listener(runId, event);
    },
    emitConfirmation(request) {
      for (const listener of confirmationListeners) listener(request);
    },
    ...overrides,
  };
  return bridge;
}

const nativeDouble: NativeAdapter = { systemInfo: vi.fn(), launchApp: vi.fn(), listApps: vi.fn(async () => []) };

function setup(bridge: NativeBridge) {
  const engine = createEngine({ native: nativeDouble, bridge, osint: { run: vi.fn() }, locale: "fr", responseHoldMs: 0 });
  const events: EngineEvent[] = [];
  engine.subscribe((event) => events.push(event));
  return { engine, events };
}

const presented = (events: EngineEvent[]) => events.flatMap((event) => (event.type === "present" ? [event.content] : []));
const assistant = (events: EngineEvent[]) => events.flatMap((event) => (event.type === "message" && event.role === "assistant" ? [event.text] : []));

describe("commandes de plugins WebAssembly (phase 5)", () => {
  const converter = {
    id: "community.exemple.convertisseur",
    name: "Convertisseur",
    version: "1.0.0",
    language: null,
    aliases: null,
    actions: [{ name: "convertit", triggers: ["convertis", "convertir"], description: "Convertit" }],
  };

  it("exécute la commande déclenchée, avec le texte qui suit le déclencheur", async () => {
    const bridge = fakeBridge({
      pluginPacks: vi.fn(async () => [converter]),
      pluginRun: vi.fn(async () => ({ caption: "12,00 km = 7,46 mi", table: null })),
    });
    const { engine, events } = setup(bridge);
    await engine.submit("convertis 12 km en miles");
    expect(bridge.pluginRun).toHaveBeenCalledWith("community.exemple.convertisseur", "convertit", "12 km en miles");
    expect(assistant(events)).toContain("12,00 km = 7,46 mi");
  });

  it("ne lance aucune commande quand aucun plugin n'est installé", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("convertis 12 km en miles");
    expect(bridge.pluginRun).not.toHaveBeenCalled();
    expect(assistant(events).join(" ")).toContain("convertis 12 km en miles");
  });
});

describe("plugins de données (phase 5)", () => {
  it("examine puis installe une adresse HTTPS, chaque étape passant par le natif", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("installe le plugin https://example.org/ana/verbes.git");
    expect(bridge.pluginPrepare).toHaveBeenCalledWith("https://example.org/ana/verbes.git");
    expect(bridge.pluginInstall).toHaveBeenCalledWith("stage-1-0", "sha256:abc");
    expect(assistant(events)).toContain("Plugin « community.ana.verbes » installé (version 1.0.0).");
  });

  it("résout un identifiant du catalogue avant d'examiner la source", async () => {
    const bridge = fakeBridge();
    const { engine } = setup(bridge);
    await engine.submit("installe le plugin community.ana.verbes");
    expect(bridge.pluginIndex).toHaveBeenCalled();
    expect(bridge.pluginPrepare).toHaveBeenCalledWith("https://example.org/ana/verbes.git");
  });

  it("n'examine rien quand l'identifiant est absent du catalogue", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("installe le plugin community.inconnu.rien");
    expect(bridge.pluginPrepare).not.toHaveBeenCalled();
    expect(assistant(events)).toContain("Aucun plugin « community.inconnu.rien » dans le catalogue.");
  });

  it("supprime et liste les plugins par leur identifiant", async () => {
    const bridge = fakeBridge();
    const { engine } = setup(bridge);
    await engine.submit("supprime le plugin community.ana.verbes");
    expect(bridge.pluginRemove).toHaveBeenCalledWith("community.ana.verbes");
    await engine.submit("liste mes plugins");
    expect(bridge.pluginList).toHaveBeenCalled();
  });

  it("recharge les paquets après une installation", async () => {
    const bridge = fakeBridge();
    const { engine } = setup(bridge);
    await engine.submit("installe le plugin https://example.org/ana/verbes.git");
    expect(bridge.pluginPacks).toHaveBeenCalled();
  });
});

describe("journal des commandes (phase 5)", () => {
  it("transmet chaque commande au journal, qui décide de la conserver", async () => {
    const bridge = fakeBridge();
    const { engine } = setup(bridge);
    await engine.submit("  Lance Discord  ");
    expect(bridge.recordJournal).toHaveBeenCalledWith("OPEN_APPLICATION", "Lance Discord");
  });

  it("ne bloque jamais une commande quand le journal est indisponible", async () => {
    const bridge = fakeBridge({ recordJournal: vi.fn(async () => { throw new Error("journal indisponible"); }) });
    const { engine, events } = setup(bridge);
    await engine.submit("Analyse example.com");
    expect(bridge.recordJournal).toHaveBeenCalled();
    expect(events.some((event) => event.type === "message")).toBe(true);
  });
});

describe("fenêtres (phase 4)", () => {
  it("liste les fenêtres visibles", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("Liste mes fenêtres ouvertes");
    expect(bridge.listWindows).toHaveBeenCalled();
    expect(presented(events)).toContainEqual(expect.objectContaining({ kind: "data-table", rows: [["Document1 - Word", "WINWORD.EXE"], ["Facture - Navigateur", "chrome.exe"]] }));
  });

  it("demande la fermeture de la fenêtre désignée par son nom, sans la fermer soi-même", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("ferme la fenêtre Word");
    expect(bridge.closeWindow).toHaveBeenCalledWith(101);
    expect(assistant(events)).toContain("Fermeture demandée pour « Document1 - Word ». L'application peut encore demander d'enregistrer.");
  });

  it("n'agit sur aucune fenêtre quand le nom en désigne plusieurs", async () => {
    const bridge = fakeBridge({
      listWindows: vi.fn(async () => [
        { id: 201, title: "Notes - Bloc-notes", process: "notepad.exe", pid: 1 },
        { id: 202, title: "Notes de réunion - Word", process: "WINWORD.EXE", pid: 2 },
      ]),
    });
    const { engine, events } = setup(bridge);
    await engine.submit("ferme la fenêtre notes");
    expect(bridge.closeWindow).not.toHaveBeenCalled();
    expect(assistant(events).join(" ")).toContain("Plusieurs fenêtres correspondent à « notes »");
  });

  it("garde « ferme cette fenêtre » pour NEXUS lui-même", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("ferme cette fenêtre");
    expect(bridge.closeWindow).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: "window-command", command: "close-last" });
  });
});

describe("recherche et processus", () => {
  it("cherche les PDF téléchargés cette semaine et affiche un tableau", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("Cherche mes fichiers PDF téléchargés cette semaine");

    expect(bridge.searchFiles).toHaveBeenCalledWith({ extension: "pdf", folderHint: "downloads", modifiedWithinDays: 7 });
    expect(presented(events)).toContainEqual(expect.objectContaining({ kind: "data-table", columns: ["Nom", "Dossier", "Taille", "Modifié"] }));
    expect(assistant(events)).toEqual(["2 fichier(s) trouvé(s)."]);
  });

  it("affiche les processus les plus gourmands", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("Quelles applications sont ouvertes ?");
    expect(bridge.listProcesses).toHaveBeenCalledWith(8);
    expect(presented(events)).toContainEqual(expect.objectContaining({ kind: "data-table", rows: [["Discord.exe", "4242", "0,5 Go", "3 %"]] }));
  });
});

describe("opérations sur fichiers : confirmation présentée, action native", () => {
  it("envoie un fichier à la corbeille via l'opération native (la confirmation est faite côté natif)", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("supprime /home/ana/Documents/vieux.txt");
    expect(bridge.operateFile).toHaveBeenCalledWith({ kind: "trash", path: "/home/ana/Documents/vieux.txt" });
    expect(assistant(events)).toEqual(["Envoyé à la corbeille : /home/ana/Documents/vieux.txt"]);
  });

  it("présente une demande de confirmation reçue du natif, avec ses deux réponses", () => {
    const bridge = fakeBridge();
    const { events } = setup(bridge);
    bridge.emitConfirmation({
      id: "perm-1",
      permission: "file.delete",
      rows: [{ key: "path", value: "/home/ana/Documents/vieux.txt" }],
      expiresInSecs: 120,
    });
    const card = presented(events).find((content) => content.kind === "confirmation");
    expect(card).toEqual({
      kind: "confirmation",
      requestId: "perm-1",
      title: "Envoyer à la corbeille ?",
      rows: [{ label: "Élément", value: "/home/ana/Documents/vieux.txt" }],
      approve: "Autoriser",
      refuse: "Refuser",
    });
    expect(assistant(events)).toContain("Confirmation demandée : Envoyer à la corbeille ?");
  });
});

describe("Claude Code", () => {
  it("lance le run, montre la progression, puis affiche le résultat", async () => {
    const bridge = fakeBridge({
      runAgent: vi.fn(async (runId: string) => {
        queueMicrotask(() => {
          bridge.emitAgent(runId, { kind: "started", model: "claude", cwd: "/home/ana/projet" });
          bridge.emitAgent(runId, { kind: "tool", name: "Bash", summary: "ls" });
          bridge.emitAgent(runId, { kind: "text", text: "Un fichier." });
          bridge.emitAgent(runId, { kind: "result", isError: false, text: "Le projet contient 1 fichier.", costUsd: 0.0423, turns: 2, durationMs: 4100, denials: [] });
        });
      }),
    });
    const { engine, events } = setup(bridge);
    await engine.submit("lance Claude Code dans /home/ana/projet : liste les fichiers");

    expect(bridge.runAgent).toHaveBeenCalledWith(expect.any(String), "/home/ana/projet", "liste les fichiers");
    expect(assistant(events)).toContain("Outil : Bash — ls");
    expect(assistant(events).at(-1)).toBe("Claude Code a terminé.");
    const result = presented(events).find((content) => content.kind === "information-card" && content.title === "Claude Code");
    expect(result).toMatchObject({ rows: expect.arrayContaining([{ label: "Statut", value: "Terminé" }, { label: "Coût signalé", value: "0,0423 $" }]) });
  });

  it("signale un refus de l'utilisateur sans lancer le CLI", async () => {
    const bridge = fakeBridge({
      runAgent: vi.fn(async () => {
        throw new NativeCallError("confirmation-refused", "action refusée par l'utilisateur");
      }),
    });
    const { engine, events } = setup(bridge);
    await engine.submit("lance Claude Code dans /home/ana/projet : fais un test");
    expect(assistant(events)).toContain("Action refusée par l'utilisateur.");
  });

  it("explique l'installation quand le CLI est absent", async () => {
    const bridge = fakeBridge({
      runAgent: vi.fn(async () => {
        throw new NativeCallError("agent-not-installed", "claude");
      }),
    });
    const { engine, events } = setup(bridge);
    await engine.submit("lance Claude Code dans /home/ana/projet : fais un test");
    expect(assistant(events).at(-1)).toContain("npm install -g @anthropic-ai/claude-code");
  });

  it("transmet l'annulation au natif quand la tâche est arrêtée", async () => {
    const bridge = fakeBridge({
      runAgent: vi.fn(async () => {}),
    });
    const { engine, events } = setup(bridge);
    const running = engine.submit("lance Claude Code dans /home/ana/projet : tâche longue");
    await vi.waitFor(() => expect(bridge.runAgent).toHaveBeenCalled());
    const task = engine.tasksSnapshot().find((item) => item.labelKey === "task.agent");
    expect(task).toBeDefined();
    engine.cancelTask(task!.id);
    await running;
    expect(assistant(events)).toContain("Opération annulée.");
  });

  it("demande le projet quand il n'est pas indiqué", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("lance Claude Code");
    expect(bridge.runAgent).not.toHaveBeenCalled();
    expect(assistant(events)[0]).toContain("Indique le projet");
  });
});

describe("conversation : références, questions et demandes enchaînées (phase 5)", () => {
  it("« renomme le deuxième » désigne le deuxième fichier de la dernière recherche", async () => {
    const bridge = fakeBridge();
    const { engine } = setup(bridge);
    await engine.submit("Cherche mes fichiers PDF");
    await engine.submit("renomme le deuxième en idees.pdf");
    expect(bridge.operateFile).toHaveBeenCalledWith({
      kind: "rename",
      from: "/home/ana/Téléchargements/facture.pdf",
      newName: "idees.pdf",
    });
  });

  it("un pronom ambigu pose la question, et la réponse « 2 » exécute le bon choix", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("Cherche mes fichiers PDF");
    await engine.submit("supprime-le");
    expect(bridge.operateFile).not.toHaveBeenCalled();
    expect(assistant(events).join(" ")).toContain("Lequel ? 1) contrat.pdf · 2) facture.pdf");
    await engine.submit("2");
    expect(bridge.operateFile).toHaveBeenCalledWith({ kind: "trash", path: "/home/ana/Téléchargements/facture.pdf" });
  });

  it("« non » annule la question sans rien faire", async () => {
    const bridge = fakeBridge({
      listWindows: vi.fn(async () => [
        { id: 201, title: "Notes - Bloc-notes", process: "notepad.exe", pid: 1 },
        { id: 202, title: "Notes de réunion - Word", process: "WINWORD.EXE", pid: 2 },
      ]),
    });
    const { engine, events } = setup(bridge);
    await engine.submit("ferme la fenêtre notes");
    expect(assistant(events).join(" ")).toContain("Laquelle ?");
    await engine.submit("non");
    expect(bridge.closeWindow).not.toHaveBeenCalled();
    expect(assistant(events)).toContain("D'accord, je ne fais rien.");
  });

  it("une fenêtre ambiguë se règle par la réponse : seule la fenêtre choisie est fermée", async () => {
    const bridge = fakeBridge({
      listWindows: vi.fn(async () => [
        { id: 201, title: "Notes - Bloc-notes", process: "notepad.exe", pid: 1 },
        { id: 202, title: "Notes de réunion - Word", process: "WINWORD.EXE", pid: 2 },
      ]),
    });
    const { engine } = setup(bridge);
    await engine.submit("ferme la fenêtre notes");
    await engine.submit("le deuxième");
    expect(bridge.closeWindow).toHaveBeenCalledExactlyOnceWith(202);
  });

  it("un nom proche suggère l'application, et « oui » la lance", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("lance Discrd");
    expect(assistant(events)).toContain("Tu voulais dire Discord ? 1) Discord");
    await engine.submit("oui");
    expect(nativeDouble.launchApp).toHaveBeenCalledWith("discord");
  });

  it("exécute deux demandes dans l'ordre quand elles sont reliées par « puis »", async () => {
    const bridge = fakeBridge();
    const { engine } = setup(bridge);
    await engine.submit("liste mes fenêtres puis montre le cpu");
    expect(bridge.listWindows).toHaveBeenCalled();
    expect(nativeDouble.systemInfo).toHaveBeenCalled();
    expect(vi.mocked(bridge.listWindows).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(nativeDouble.systemInfo).mock.invocationCallOrder[0]);
  });
});
