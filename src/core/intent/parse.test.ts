import { describe, expect, it } from "vitest";

import { beforeAll } from "vitest";

import { loadBuiltinPlugins } from "../plugins/builtin";
import { registerApplications, registerLanguageDictionary } from "./registry";
import { parseIntent } from "./parse";
import { normalize, stripWakeWord } from "./normalize";

beforeAll(() => {
  // Les dictionnaires et le catalogue viennent des plugins : on les charge comme le ferait le moteur.
  loadBuiltinPlugins({ registerCapability: () => {}, registerLanguage: registerLanguageDictionary, registerApplications });
});

describe("normalize", () => {
  it("supprime accents, ponctuation et casse", () => {
    expect(normalize("  Lance le Bloc-notes !  ")).toBe("lance le bloc notes");
    expect(normalize("Montre-moi l'utilisation CPU.")).toBe("montre moi l utilisation cpu");
  });

  it("garde les points internes des domaines", () => {
    expect(normalize("Analyse example.com.")).toBe("analyse example.com");
  });

  it("retire le mot d'activation en tête uniquement", () => {
    expect(stripWakeWord("jarvis lance discord")).toBe("lance discord");
    expect(stripWakeWord("lance jarvis")).toBe("lance jarvis");
  });
});

describe("parseIntent — ouverture d'application", () => {
  it.each([
    ["Lance Discord.", "discord"],
    ["Jarvis, lance Discord.", "discord"],
    ["Lance le Bloc-notes", "notepad"],
    ["ouvre la calculatrice", "calculator"],
    ["Open Notepad", "notepad"],
    ["launch google chrome please", "chrome"],
  ])("« %s » ouvre %s", (input, appId) => {
    const { intent, resolvedBy } = parseIntent(input);
    expect(intent).toMatchObject({ type: "OPEN_APPLICATION", appId });
    expect(resolvedBy).toBe("rules");
  });

  it("garde le nom demandé quand l'application est inconnue", () => {
    const { intent } = parseIntent("Lance Spotify");
    expect(intent).toEqual({ type: "OPEN_APPLICATION", appId: undefined, appName: "spotify" });
  });
});

describe("parseIntent — informations système", () => {
  it.each([
    "Affiche les informations de mon ordinateur",
    "Affiche l'utilisation CPU",
    "Montre-moi la RAM",
    "Show my computer information",
    "what is the cpu usage",
  ])("« %s » demande les ressources système", (input) => {
    expect(parseIntent(input).intent).toEqual({ type: "SYSTEM_INFO" });
  });

  it("ne confond pas une recherche d'informations avec les ressources de la machine", () => {
    expect(parseIntent("cherche des informations sur Jean Dupont").intent.type).toBe("UNKNOWN");
  });
});

describe("parseIntent — commandes de contrôle", () => {
  it.each([
    ["Ferme cette fenêtre", "CLOSE_WINDOW"],
    ["close this window", "CLOSE_WINDOW"],
    ["Ferme toutes les fenêtres", "CLOSE_ALL_WINDOWS"],
    ["Annule la recherche", "CANCEL_TASKS"],
    ["stop the task", "CANCEL_TASKS"],
    ["Que peux-tu faire ?", "HELP"],
  ])("« %s » → %s", (input, type) => {
    expect(parseIntent(input).intent.type).toBe(type);
  });
});

describe("parseIntent — repli", () => {
  it("renvoie UNKNOWN sans appeler de service pour une phrase non reconnue", () => {
    expect(parseIntent("le temps est magnifique aujourd'hui")).toMatchObject({
      intent: { type: "UNKNOWN" },
      resolvedBy: "rules",
    });
  });

  it("renvoie UNKNOWN pour une entrée vide", () => {
    expect(parseIntent("   ").intent).toEqual({ type: "UNKNOWN", text: "" });
  });
});

describe("parseIntent — analyse OSINT et fichiers", () => {
  it("extrait le domaine d'une demande d'analyse, sans appel réseau", () => {
    expect(parseIntent("Analyse example.com").intent).toEqual({ type: "OSINT_DOMAIN", domain: "example.com" });
    expect(parseIntent("Jarvis, cherche des informations sur Example.COM.").intent).toEqual({ type: "OSINT_DOMAIN", domain: "example.com" });
    expect(parseIntent("analyse https://www.example.org/page").intent).toEqual({ type: "OSINT_DOMAIN", domain: "www.example.org" });
  });

  it("n'interprète pas un nom de fichier comme un domaine", () => {
    expect(parseIntent("analyse rapport.pdf").intent.type).toBe("UNKNOWN");
  });

  it("extrait le pseudo en gardant sa casse", () => {
    expect(parseIntent("Recherche le pseudo JeanDupont42 sur internet").intent).toEqual({ type: "OSINT_USERNAME", username: "JeanDupont42" });
    expect(parseIntent("Recherche ce pseudo sur Internet").intent.type).toBe("UNKNOWN");
  });

  it("refuse explicitement les adresses email en phase 3", () => {
    expect(parseIntent("analyse jean.dupont@example.com").intent).toMatchObject({ type: "UNSUPPORTED", reason: "email" });
  });

  it("garde le chemin de fichier tel quel, avec ses majuscules et ses barres", () => {
    expect(parseIntent('Analyse le fichier "C:\\Users\\Ana\\Documents\\Contrat.PDF"').intent).toEqual({
      type: "DOCUMENT_INSPECT",
      path: "C:\\Users\\Ana\\Documents\\Contrat.PDF",
    });
  });

  it("n'attribue pas l'analyse à une simple ouverture d'application", () => {
    expect(parseIntent("lance discord").intent).toMatchObject({ type: "OPEN_APPLICATION", appId: "discord" });
  });
});

describe("parseIntent — fenêtres (phase 4)", () => {
  it.each([
    ["ferme la fenêtre Word", { type: "WINDOW_CLOSE", name: "Word" }],
    ["Jarvis, ferme la fenêtre « Discord ».", { type: "WINDOW_CLOSE", name: "Discord" }],
    ["passe sur la fenêtre Discord", { type: "WINDOW_FOCUS", name: "Discord" }],
    ["liste mes fenêtres ouvertes", { type: "WINDOW_LIST" }],
    ["quelles fenêtres sont ouvertes ?", { type: "WINDOW_LIST" }],
  ])("« %s » est reconnue", (input, intent) => {
    expect(parseIntent(input).intent).toEqual(intent);
  });

  it("garde les commandes de NEXUS sur ses propres fenêtres", () => {
    expect(parseIntent("ferme cette fenêtre").intent.type).toBe("CLOSE_WINDOW");
    expect(parseIntent("ferme toutes les fenêtres").intent.type).toBe("CLOSE_ALL_WINDOWS");
    expect(parseIntent("ferme toutes les fenêtres ouvertes").intent.type).toBe("CLOSE_ALL_WINDOWS");
    expect(parseIntent("ferme la fenêtre").intent.type).not.toBe("WINDOW_CLOSE");
  });
});

describe("parseIntent — fichiers, processus et agents (phase 4)", () => {
  it("cherche des fichiers par extension, dossier et période", () => {
    expect(parseIntent("Cherche mes fichiers PDF téléchargés cette semaine").intent).toEqual({
      type: "FILE_SEARCH",
      extension: "pdf",
      folderHint: "downloads",
      withinDays: 7,
    });
    expect(parseIntent("trouve mes fichiers txt").intent).toMatchObject({ type: "FILE_SEARCH", extension: "txt" });
  });

  it("ne prend pas un chemin de fichier pour une recherche", () => {
    expect(parseIntent("cherche le fichier /tmp/notes.txt").intent.type).not.toBe("FILE_SEARCH");
  });

  it("renomme, déplace et supprime uniquement des chemins absolus, en gardant leur casse", () => {
    expect(parseIntent('renomme "C:\\Users\\Ana\\Documents\\Facture.pdf" en Facture-2026.pdf').intent).toEqual({
      type: "FILE_RENAME",
      path: "C:\\Users\\Ana\\Documents\\Facture.pdf",
      newName: "Facture-2026.pdf",
    });
    expect(parseIntent("déplace /home/ana/Documents/a.pdf dans /home/ana/Archives").intent).toEqual({
      type: "FILE_MOVE",
      path: "/home/ana/Documents/a.pdf",
      toDir: "/home/ana/Archives",
    });
    expect(parseIntent("supprime /home/ana/Documents/vieux.txt").intent).toEqual({
      type: "FILE_TRASH",
      path: "/home/ana/Documents/vieux.txt",
    });
    expect(parseIntent("supprime mes vieux fichiers").intent.type).not.toBe("FILE_TRASH");
  });

  it("affiche les processus actifs", () => {
    expect(parseIntent("Quelles applications sont ouvertes ?").intent).toEqual({ type: "PROCESS_LIST" });
  });

  it("lance Claude Code dans un projet avec sa demande", () => {
    expect(parseIntent("lance Claude Code dans /home/ana/projet : corrige le bug de connexion").intent).toEqual({
      type: "AGENT_RUN",
      project: "/home/ana/projet",
      prompt: "corrige le bug de connexion",
    });
    expect(parseIntent('Jarvis, lance claude code sur "C:\\Dev\\mon projet" et demande-lui de lister les TODO').intent).toEqual({
      type: "AGENT_RUN",
      project: "C:\\Dev\\mon projet",
      prompt: "lister les TODO",
    });
  });

  it("demande le projet quand il manque, au lieu de deviner", () => {
    expect(parseIntent("lance Claude Code").intent).toEqual({ type: "AGENT_RUN", project: undefined, prompt: undefined });
  });
});

