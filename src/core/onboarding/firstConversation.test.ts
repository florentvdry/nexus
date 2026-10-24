import { describe, expect, it, vi } from "vitest";

import { translate } from "../../i18n/messages";
import type { MemoryBridge } from "../memory/memory";
import { acceptable, FirstConversation, QUESTIONS } from "./firstConversation";

// Une réponse valide pour chaque question, dans l'ordre.
const ANSWERS = ["Florent", "Lyon", "développeur", "gérer mes projets", "tutoiement", "réponses courtes", "rien de spécial"];

function setup() {
  const memoryAdd = vi.fn(async (text: string, source: "user" | "model") => ({ id: 1, text, createdAt: 0, source }));
  const bridge = { memoryAdd } as unknown as MemoryBridge;
  const said: string[] = [];
  const conversation = new FirstConversation({
    bridge,
    say: (text) => said.push(text),
    t: (key, params) => translate("fr", key, params),
  });
  return { conversation, memoryAdd, said };
}

describe("première conversation", () => {
  it("se présente, pose la première question, et ne prend pas les saisies avant d'être lancée", async () => {
    const { conversation, said } = setup();
    expect(conversation.active).toBe(false);
    expect(await conversation.consume("bonjour")).toBe(false);
    conversation.start();
    expect(conversation.active).toBe(true);
    expect(said[0]).toContain("quelques questions");
    expect(said[1]).toBe(translate("fr", QUESTIONS[0].ask));
  });

  it("garde chaque réponse valide comme souvenir « libellé : réponse », question après question", async () => {
    const { conversation, memoryAdd, said } = setup();
    conversation.start();
    await conversation.consume("Florent");
    expect(memoryAdd).toHaveBeenCalledWith("Prénom : Florent", "user");
    expect(said.at(-1)).toBe(translate("fr", QUESTIONS[1].ask));
  });

  it("une question passée ne garde rien pour elle", async () => {
    const { conversation, memoryAdd } = setup();
    conversation.start();
    await conversation.consume("passer");
    expect(memoryAdd).not.toHaveBeenCalled();
    expect(conversation.active).toBe(true);
  });

  it("une salutation n'est jamais gardée comme réponse : la question est reposée avec un indice", async () => {
    const { conversation, memoryAdd, said } = setup();
    conversation.start();
    await conversation.consume("salut");
    expect(memoryAdd).not.toHaveBeenCalled();
    expect(said).toContain(translate("fr", "onboarding.retry"));
    expect(said.at(-1)).toBe(translate("fr", QUESTIONS[0].ask));
  });

  it("une réponse hors sujet pour le ton est refusée tant qu'elle ne le dit pas", async () => {
    const { conversation, memoryAdd } = setup();
    conversation.start();
    for (const answer of ANSWERS.slice(0, 4)) await conversation.consume(answer);
    await conversation.consume("ok");
    expect(memoryAdd).toHaveBeenCalledTimes(4);
    expect(conversation.active).toBe(true);
  });

  it("se termine après la dernière question, par un message de fin", async () => {
    const { conversation, memoryAdd, said } = setup();
    conversation.start();
    for (const answer of ANSWERS) await conversation.consume(answer);
    expect(memoryAdd).toHaveBeenCalledTimes(QUESTIONS.length);
    expect(conversation.active).toBe(false);
    expect(said.at(-1)).toBe(translate("fr", "onboarding.done"));
    expect(await conversation.consume("quelle heure est-il ?")).toBe(false);
  });
});

describe("contrôle des réponses", () => {
  it("accepte un vrai prénom et refuse une salutation ou un mot trop court", () => {
    expect(acceptable("name", "Florent")).toBe(true);
    expect(acceptable("name", "salut")).toBe(false);
    expect(acceptable("name", "x")).toBe(false);
  });

  it("le ton et la longueur doivent répondre à la question", () => {
    expect(acceptable("tone", "tutoiement")).toBe(true);
    expect(acceptable("tone", "oui")).toBe(false);
    expect(acceptable("length", "plutôt courtes")).toBe(true);
    expect(acceptable("length", "bof")).toBe(false);
  });
});
