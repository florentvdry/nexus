import { describe, expect, it, vi } from "vitest";

import { translate } from "../../i18n/messages";
import type { MemoryBridge } from "../memory/memory";
import { FirstConversation, QUESTIONS } from "./firstConversation";

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

  it("garde chaque réponse comme souvenir « libellé : réponse », question après question", async () => {
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

  it("se termine après la dernière question, par un message de fin", async () => {
    const { conversation, memoryAdd, said } = setup();
    conversation.start();
    for (let index = 0; index < QUESTIONS.length; index += 1) await conversation.consume(`réponse ${index}`);
    expect(memoryAdd).toHaveBeenCalledTimes(QUESTIONS.length);
    expect(conversation.active).toBe(false);
    expect(said.at(-1)).toBe(translate("fr", "onboarding.done"));
    expect(await conversation.consume("quelle heure est-il ?")).toBe(false);
  });
});
