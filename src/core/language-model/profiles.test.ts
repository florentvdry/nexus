import { describe, expect, it } from "vitest";

import { answerModel, PROFILE_TIERS } from "./selection";

describe("profils et modèle des réponses ouvertes", () => {
  it("relie chaque profil à un niveau du modèle", () => {
    expect(PROFILE_TIERS).toEqual({ fast: "light", balanced: "balanced", precise: "precise" });
  });

  it("répond avec le plus précis installé", () => {
    expect(answerModel(["qwen2.5:1.5b", "qwen2.5:7b", "qwen2.5:14b"], "qwen2.5:1.5b")).toBe("qwen2.5:14b");
  });

  it("à défaut, prend le niveau équilibré installé", () => {
    expect(answerModel(["qwen2.5:1.5b", "qwen2.5:7b"], "qwen2.5:1.5b")).toBe("qwen2.5:7b");
  });

  it("sans niveau plus grand, garde le modèle choisi", () => {
    expect(answerModel(["qwen2.5:1.5b"], "qwen2.5:1.5b")).toBe("qwen2.5:1.5b");
    expect(answerModel([], null)).toBeNull();
  });
});
