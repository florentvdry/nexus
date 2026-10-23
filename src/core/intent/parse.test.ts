import { describe, expect, it } from "vitest";

import { parseIntent } from "./parse";
import { normalize, stripWakeWord } from "./normalize";

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
    const { intent } = parseIntent("Lance Claude Code");
    expect(intent).toEqual({ type: "OPEN_APPLICATION", appId: undefined, appName: "claude code" });
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
