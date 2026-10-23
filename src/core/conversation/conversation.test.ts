import { describe, expect, it } from "vitest";

import { Conversation, answerClarification } from "./conversation";
import type { Referent } from "./types";

const files: Referent[] = [
  { kind: "file", label: "facture.txt", value: "/root/Documents/nexus-e2e/facture.txt" },
  { kind: "file", label: "notes.txt", value: "/root/Documents/nexus-e2e/notes.txt" },
];

function withFiles(list: Referent[] = files): Conversation {
  const conversation = new Conversation();
  conversation.setReferents(list);
  return conversation;
}

describe("références dans la conversation", () => {
  it("réécrit « le deuxième » avec le chemin de l'élément désigné", () => {
    expect(withFiles().resolve("renomme le deuxième en idees.txt").text).toBe('renomme le fichier "/root/Documents/nexus-e2e/notes.txt" en idees.txt');
    expect(withFiles().resolve("supprime le dernier").text).toBe('supprime le fichier "/root/Documents/nexus-e2e/notes.txt"');
    expect(withFiles().resolve("analyse le premier").text).toBe('analyse le fichier "/root/Documents/nexus-e2e/facture.txt"');
  });

  it("accepte les formes accentuées et la dictée", () => {
    expect(withFiles().resolve("supprime la deuxième").text).toContain("notes.txt");
    expect(withFiles().resolve("supprime la deuxieme").text).toContain("notes.txt");
  });

  it("réécrit un pronom unique : « ferme-le », « renomme ça en X », « renomme le en X »", () => {
    const one = withFiles([files[0]]);
    expect(one.resolve("analyse-le").text).toBe('analyse le fichier "/root/Documents/nexus-e2e/facture.txt"');
    expect(one.resolve("renomme ça en neuf.txt").text).toBe('renomme le fichier "/root/Documents/nexus-e2e/facture.txt" en neuf.txt');
    expect(one.resolve("renomme le en neuf.txt").text).toContain('"/root/Documents/nexus-e2e/facture.txt"');
  });

  it("ne touche jamais une demande d'application qui contient « la »", () => {
    expect(withFiles().resolve("ouvre la calculatrice").text).toBe("ouvre la calculatrice");
    expect(withFiles().resolve("retiens le pain").text).toBe("retiens le pain");
  });

  it("demande lequel quand un pronom ne désigne pas un seul élément", () => {
    const resolution = withFiles().resolve("ferme-le");
    expect(resolution.clarification?.question).toBe("Lequel ?");
    expect(resolution.clarification?.options.map((option) => option.label)).toEqual(["facture.txt", "notes.txt"]);
    expect(resolution.clarification?.options[1].text).toContain("notes.txt");
  });

  it("sans liste précédente, rien n'est réécrit", () => {
    expect(new Conversation().resolve("renomme le deuxième en x").text).toBe("renomme le deuxième en x");
  });
});

describe("réponse à une question", () => {
  const options = [
    { label: "Document1 - Word", text: "ferme la fenêtre #101" },
    { label: "Notes - Bloc-notes", text: "ferme la fenêtre #102" },
  ];

  it("accepte un numéro, un ordinal ou un libellé", () => {
    expect(answerClarification({ question: "?", options }, "2")).toEqual(options[1]);
    expect(answerClarification({ question: "?", options }, "le premier")).toEqual(options[0]);
    expect(answerClarification({ question: "?", options }, "notes")).toEqual(options[1]);
  });

  it("refuse, ou ne répond pas à une saisie hors sujet", () => {
    expect(answerClarification({ question: "?", options }, "non")).toBe("cancel");
    expect(answerClarification({ question: "?", options }, "ouvre discord")).toBeNull();
    expect(answerClarification({ question: "?", options }, "9")).toBeNull();
  });

  it("« oui » ne vaut que pour une option unique", () => {
    expect(answerClarification({ question: "?", options: [options[0]] }, "oui")).toEqual(options[0]);
    expect(answerClarification({ question: "?", options }, "oui")).toBeNull();
  });
});
