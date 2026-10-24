import { describe, expect, it } from "vitest";

import { answerClarification, Conversation } from "./conversation";
import type { Clarification } from "./types";

const choice: Clarification = {
  question: "Lequel ?",
  options: [
    { label: "notes.txt", text: "ouvre notes.txt" },
    { label: "facture.txt", text: "ouvre facture.txt" },
  ],
};

describe("réponse à une question à choix", () => {
  it("accepte un numéro, un ordinal ou le libellé", () => {
    expect(answerClarification(choice, "2")).toEqual(choice.options[1]);
    expect(answerClarification(choice, "le premier")).toEqual(choice.options[0]);
    expect(answerClarification(choice, "dernier")).toEqual(choice.options[1]);
    expect(answerClarification(choice, "facture")).toEqual(choice.options[1]);
  });

  it("« oui » ne vaut que pour une option unique, « non » annule", () => {
    expect(answerClarification(choice, "oui")).toBeNull();
    expect(answerClarification({ question: "?", options: [choice.options[0]] }, "oui")).toEqual(choice.options[0]);
    expect(answerClarification(choice, "non")).toBe("cancel");
  });

  it("une réponse hors choix n'est pas devinée", () => {
    expect(answerClarification(choice, "quelle heure est-il ?")).toBeNull();
  });
});

describe("mémoire de la conversation", () => {
  it("garde les éléments affichés, et une liste vide les efface", () => {
    const conversation = new Conversation();
    conversation.setReferents([{ kind: "file", label: "notes.txt", value: "/docs/notes.txt" }]);
    expect(conversation.referents()).toHaveLength(1);
    conversation.setReferents([]);
    expect(conversation.referents()).toHaveLength(0);
  });

  it("garde la question en attente jusqu'à sa réponse", () => {
    const conversation = new Conversation();
    conversation.ask(choice);
    expect(conversation.pending()).toEqual(choice);
    conversation.clearPending();
    expect(conversation.pending()).toBeNull();
  });
});
