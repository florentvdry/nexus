import { describe, expect, it, vi } from "vitest";

import { NativeCallError, type NativeAdapter } from "../native/adapter";
import type { AgentEvent, AutoApproval, ConfirmationRequest, NativeBridge } from "../native/bridge";
import { createEngine, type EngineEvent } from "./engine";
import { TEST_MODEL } from "../testing/scripted";

// Ce que le modèle local répond à chaque phrase de ces tests (intention JSON, validée ensuite par le moteur).
const MODEL_ANSWERS: Record<string, unknown> = {
  "convertis 12 km en miles": { type: "PLUGIN_ACTION", pluginId: "community.exemple.convertisseur", command: "convertit", text: "12 km en miles" },
  "installe le plugin https://example.org/ana/verbes.git": { type: "PLUGIN_INSTALL", target: "https://example.org/ana/verbes.git" },
  "installe le plugin community.ana.verbes": { type: "PLUGIN_INSTALL", target: "community.ana.verbes" },
  "installe le plugin community.inconnu.rien": { type: "PLUGIN_INSTALL", target: "community.inconnu.rien" },
  "supprime le plugin community.ana.verbes": { type: "PLUGIN_REMOVE", id: "community.ana.verbes" },
  "liste mes plugins": { type: "PLUGIN_LIST" },
  "Lance Discord": { type: "OPEN_APPLICATION", appName: "Discord" },
  "Analyse example.com": { type: "OSINT_DOMAIN", domain: "example.com" },
  "Liste mes fenêtres ouvertes": { type: "WINDOW_LIST" },
  "ferme la fenêtre Word": { type: "WINDOW_CLOSE", name: "Word" },
  "ferme la fenêtre notes": { type: "WINDOW_CLOSE", name: "notes" },
  "ferme cette fenêtre": { type: "CLOSE_WINDOW" },
  "ferme la fenêtre #202": { type: "WINDOW_CLOSE", name: "#202" },
  "Cherche mes fichiers PDF téléchargés cette semaine": { type: "FILE_SEARCH", extension: "pdf", folderHint: "downloads", withinDays: 7 },
  "Cherche mes fichiers PDF": { type: "FILE_SEARCH", extension: "pdf" },
  "Quelles applications sont ouvertes ?": { type: "PROCESS_LIST" },
  "supprime /home/ana/Documents/vieux.txt": { type: "FILE_TRASH", path: "/home/ana/Documents/vieux.txt" },
  "lance Claude Code dans /home/ana/projet : liste les fichiers": { type: "AGENT_RUN", project: "/home/ana/projet", prompt: "liste les fichiers" },
  "lance Claude Code dans /home/ana/projet : fais un test": { type: "AGENT_RUN", project: "/home/ana/projet", prompt: "fais un test" },
  "lance Claude Code dans /home/ana/projet : tâche longue": { type: "AGENT_RUN", project: "/home/ana/projet", prompt: "tâche longue" },
  "lance Claude Code": { type: "AGENT_RUN" },
  "renomme le deuxième en idees.pdf": { type: "FILE_RENAME", path: "/home/ana/Téléchargements/facture.pdf", newName: "idees.pdf" },
  "Lance Discrd": { type: "OPEN_APPLICATION", appName: "Discrd" },
  "salut": { type: "UNKNOWN", reply: "Salut ! Que veux-tu faire ?" },
  "xyzzy plugh": { type: "UNKNOWN", text: "xyzzy plugh" },
  "retiens que je préfère Firefox": { type: "REMEMBER", text: "je préfère Firefox" },
  "qu'est-ce que tu retiens de moi ?": { type: "MEMORY_LIST" },
  "affiche une photo de Macron": { type: "SHOW_IMAGE", query: "Emmanuel Macron" },
  "qui est Marie Curie ?": { type: "SHOW_TOPIC", query: "Marie Curie" },
  "fais un résumé des actus du jour": { type: "NEWS_SUMMARY" },
};

// Pont natif SIMULÉ : réponses fixes, sans toucher au disque, aux processus ni au CLI réel.
function fakeBridge(overrides: Partial<NativeBridge> = {}) {
  const agentListeners = new Set<(runId: string, event: AgentEvent) => void>();
  const confirmationListeners = new Set<(request: ConfirmationRequest) => void>();
  const autoApprovalListeners = new Set<(approval: AutoApproval) => void>();
  const bridge: NativeBridge & {
    emitAgent(runId: string, event: AgentEvent): void;
    emitConfirmation(request: ConfirmationRequest): void;
    emitAutoApproval(approval: AutoApproval): void;
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
    listRules: vi.fn(async () => []),
    revokeRule: vi.fn(async () => true),
    listAudit: vi.fn(async () => []),
    hardwareProfile: vi.fn(async () => ({ memoryGiB: 16, cores: 8, avx2: true, gpu: null })),
    classifyIntent: vi.fn(async (text: string) => {
      if (!(text in MODEL_ANSWERS)) throw new Error("réponse du modèle non prévue par le test : " + text);
      return MODEL_ANSWERS[text];
    }),
    ollamaStatus: vi.fn(async () => ({ reachable: false, models: [] })),
    pullModel: vi.fn(async () => {}),
    installOllama: vi.fn(async () => {}),
    modelJson: vi.fn(async () => {
      throw new Error("modèle non installé");
    }),
    mcpSearch: vi.fn(async () => []),
    mcpInstalled: vi.fn(async () => []),
    mcpInstall: vi.fn(async () => {
      throw new Error("connecteur inconnu");
    }),
    mcpSetValue: vi.fn(async () => {}),
    mcpTools: vi.fn(async () => []),
    mcpCall: vi.fn(async () => ""),
    memoryList: vi.fn(async () => []),
    memoryAdd: vi.fn(async (text: string, source: "user" | "model") => ({ id: 1, text, createdAt: 0, source })),
    memoryRemove: vi.fn(async () => true),
    memoryForget: vi.fn(async () => 0),
    memoryClear: vi.fn(async () => 0),
    scheduleList: vi.fn(async () => []),
    scheduleSave: vi.fn(async () => {}),
    webSummary: vi.fn(async () => ({ title: "Emmanuel Macron", extract: "Homme d'État français.", page: "https://fr.wikipedia.org/wiki/Emmanuel_Macron" })),
    webNews: vi.fn(async () => [{ text: "17 octobre : manifestations.", page: "https://fr.wikipedia.org/wiki/Manifestations" }]),
    webPhoto: vi.fn(async () => ({ title: "Macron.jpg", dataUrl: "data:image/jpeg;base64,AAAA", credit: "Simon Dawson", license: "CC BY 2.0", page: "https://commons.wikimedia.org/wiki/File:Macron.jpg" })),
    onAutoApproval: (listener) => {
      autoApprovalListeners.add(listener);
      return () => autoApprovalListeners.delete(listener);
    },
    emitAgent(runId, event) {
      for (const listener of agentListeners) listener(runId, event);
    },
    emitConfirmation(request) {
      for (const listener of confirmationListeners) listener(request);
    },
    emitAutoApproval(approval) {
      for (const listener of autoApprovalListeners) listener(approval);
    },
    ...overrides,
  };
  return bridge;
}

const nativeDouble: NativeAdapter = { systemInfo: vi.fn(), launchApp: vi.fn(), listApps: vi.fn(async () => []) };

function setup(bridge: NativeBridge) {
  const engine = createEngine({ native: nativeDouble, bridge, osint: { run: vi.fn() }, model: () => TEST_MODEL, locale: "fr", responseHoldMs: 0 });
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
    const bridge = fakeBridge({ classifyIntent: vi.fn(async () => ({ type: "UNKNOWN", text: "convertis 12 km en miles" })) });
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
      rememberable: false,
      scope: null,
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

  it("propose « toujours autoriser » pour une écriture, avec le dossier que la règle couvrirait", () => {
    const bridge = fakeBridge();
    const { events } = setup(bridge);
    bridge.emitConfirmation({
      id: "perm-2",
      permission: "file.write",
      rows: [{ key: "from", value: "/home/ana/Documents/a.pdf" }],
      expiresInSecs: 120,
      rememberable: true,
      scope: "/home/ana/Documents",
    });
    const card = presented(events).find((content) => content.kind === "confirmation");
    expect(card).toMatchObject({ remember: { label: "Toujours autoriser dans ce dossier : /home/ana/Documents" } });
  });

  it("propose « toujours autoriser » pour un projet Claude Code, et jamais pour une suppression", () => {
    const bridge = fakeBridge();
    const { events } = setup(bridge);
    bridge.emitConfirmation({
      id: "perm-3",
      permission: "agent.run",
      rows: [{ key: "project", value: "/home/ana/projet" }],
      expiresInSecs: 120,
      rememberable: true,
      scope: "/home/ana/projet",
    });
    bridge.emitConfirmation({
      id: "perm-4",
      permission: "file.delete",
      rows: [{ key: "path", value: "/home/ana/a.txt" }],
      expiresInSecs: 120,
      rememberable: false,
      scope: "/home/ana",
    });
    const cards = presented(events).filter((content) => content.kind === "confirmation");
    expect(cards[0]).toMatchObject({ remember: { label: "Toujours autoriser pour ce projet : /home/ana/projet" } });
    expect(cards[1]).not.toHaveProperty("remember");
  });

  it("annonce dans la conversation une action approuvée par une règle, sans question", () => {
    const bridge = fakeBridge();
    const { events } = setup(bridge);
    bridge.emitAutoApproval({ at: 1_780_000_000, permission: "file.write", scope: "/home/ana/Documents" });
    expect(assistant(events)).toEqual(["Autorisé par une règle mémorisée, sans question : modifier un fichier (/home/ana/Documents)."]);
    expect(presented(events)).toEqual([]);
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

  it("un nom inconnu ne lance rien, et le dit", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("Lance Discrd");
    expect(nativeDouble.launchApp).not.toHaveBeenCalled();
    expect(assistant(events).join(" ")).toContain("Discrd");
  });

});

describe("salutations : une réponse aimable, jamais une erreur", () => {
  it("répond à « salut » par la réponse du modèle, sans carte d'erreur", async () => {
    const { engine, events } = setup(fakeBridge());
    await engine.submit("salut");
    expect(assistant(events)).toContain("Salut ! Que veux-tu faire ?");
    expect(presented(events).some((content) => content.kind === "error-card")).toBe(false);
  });

  it("garde le message « je n'ai pas compris » pour une demande vraiment incomprise", async () => {
    const { engine, events } = setup(fakeBridge());
    await engine.submit("xyzzy plugh");
    expect(assistant(events).some((text) => text.includes("Je n'ai pas compris"))).toBe(true);
  });
});

describe("connecteurs MCP : une demande hors des capacités propose un connecteur", () => {
  it("le modèle reconnaît un service extérieur ; NEXUS cherche, propose, et n'installe rien sans « oui »", async () => {
    const mcpSearch = vi.fn(async () => [
      {
        id: "app.example/discord",
        title: "discord",
        description: "Discord",
        repository: "https://github.com/acme/discord-mcp",
        stars: 120,
        package: "@acme/discord-mcp",
        version: "1.2.0",
        env: [],
      },
    ]);
    const bridge = fakeBridge({
      classifyIntent: vi.fn(async () => ({ type: "NEEDS_CONNECTOR", service: "Discord", task: "envoyer un message à Anthony" })),
      mcpSearch,
    });
    const { engine, events } = setup(bridge);
    await engine.submit("envoie un message Discord à Anthony pour lui dire que je l'attends");
    expect(mcpSearch).toHaveBeenCalledWith("Discord");
    expect(assistant(events).some((text) => text.includes("discord") && text.includes("120"))).toBe(true);
    expect(bridge.mcpInstall).not.toHaveBeenCalled();
  });
});

describe("mémoire : l'utilisateur demande de retenir, oublier, lister", () => {
  it("« retiens que… » enregistre tout de suite ; « qu'est-ce que tu retiens » répond avec la liste", async () => {
    const memoryAdd = vi.fn(async (text: string, source: "user" | "model") => ({ id: 1, text, createdAt: 0, source }));
    const memoryList = vi.fn(async () => [{ id: 1, text: "je préfère Firefox", createdAt: 0, source: "user" as const }]);
    const { engine, events } = setup(fakeBridge({ memoryAdd, memoryList }));
    await engine.submit("retiens que je préfère Firefox");
    expect(memoryAdd).toHaveBeenCalledWith("je préfère Firefox", "model");
    await engine.submit("qu'est-ce que tu retiens de moi ?");
    expect(assistant(events).some((text) => text.includes("1) je préfère Firefox"))).toBe(true);
  });
});

describe("fenêtres par demande : une demande, une fenêtre", () => {
  it("« affiche une photo de Macron » ouvre une fenêtre image, avec son auteur et sa licence", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("affiche une photo de Macron");
    expect(bridge.webPhoto).toHaveBeenCalledWith("Emmanuel Macron");
    expect(presented(events)).toContainEqual(expect.objectContaining({ kind: "image-card", credit: "Simon Dawson", license: "CC BY 2.0" }));
    expect(assistant(events)).toContain("Photo : Macron.jpg");
  });

  it("« qui est Marie Curie ? » ouvre une fenêtre résumé, avec la page d'origine", async () => {
    const bridge = fakeBridge({ webSummary: vi.fn(async () => ({ title: "Marie Curie", extract: "Physicienne et chimiste.", page: "https://fr.wikipedia.org/wiki/Marie_Curie" })) });
    const { engine, events } = setup(bridge);
    await engine.submit("qui est Marie Curie ?");
    expect(bridge.webSummary).toHaveBeenCalledWith("Marie Curie");
    expect(presented(events)).toContainEqual(expect.objectContaining({ kind: "article-card", extract: "Physicienne et chimiste." }));
  });

  it("« résume les actus » ouvre la liste du jour, avec sa source", async () => {
    const bridge = fakeBridge();
    const { engine, events } = setup(bridge);
    await engine.submit("fais un résumé des actus du jour");
    expect(presented(events).some((content) => content.kind === "image-card" || content.kind === "article-card")).toBe(false);
    expect(presented(events)).toContainEqual(expect.objectContaining({ kind: "news-list", source: expect.stringContaining("Wikipédia") }));
    expect(assistant(events).join(" ")).toContain("1 actualité");
  });

  it("une source injoignable devient une carte d'erreur, pas une fenêtre vide", async () => {
    const bridge = fakeBridge({ webPhoto: vi.fn(async () => { throw new Error("source injoignable (timeout)"); }) });
    const { engine, events } = setup(bridge);
    await engine.submit("affiche une photo de Macron");
    expect(presented(events).some((content) => content.kind === "image-card")).toBe(false);
    expect(events.some((event) => event.type === "present" && event.content.kind === "error-card")).toBe(true);
  });
});

describe("retour immédiat pendant une recherche web", () => {
  it("annonce ce qu'elle cherche avant d'ouvrir la fenêtre", async () => {
    const { engine, events } = setup(fakeBridge());
    await engine.submit("affiche une photo de Macron");
    const messages = assistant(events);
    expect(messages[0]).toContain("Je cherche « Emmanuel Macron »");
    expect(messages.at(-1)).toContain("Photo : Macron.jpg");
  });
});
