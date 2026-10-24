import { describe, expect, it, vi } from "vitest";

import type { HardwareProfile } from "./hardware";
import { nativeClassifier } from "./classifier";
import { readSelectedModel, recommendedModel } from "./selection";
import { TIERS } from "./tiers";
import type { NativeBridge } from "../native/bridge";

const machine = (overrides: Partial<HardwareProfile> = {}): HardwareProfile => ({
  memoryGiB: 16,
  cores: 8,
  avx2: true,
  gpu: null,
  ...overrides,
});

describe("choix du modèle", () => {
  it("sans choix enregistré (ou hors navigateur), aucun modèle : les règles seules", () => {
    expect(readSelectedModel()).toBeNull();
  });

  it("recommande le modèle du niveau le plus précis que la machine supporte", () => {
    expect(recommendedModel(machine())).toBe("qwen2.5:14b");
    expect(recommendedModel(machine({ cores: 4 }))).toBe("qwen2.5:7b");
    expect(recommendedModel(machine({ memoryGiB: 2, cores: 2, avx2: false }))).toBeNull();
  });

  it("chaque niveau a un modèle recommandé sous licence Apache 2.0 (pas la taille 3 B)", () => {
    for (const tier of TIERS) {
      expect(tier.model).toMatch(/^qwen2\.5:/);
      expect(tier.model).not.toBe("qwen2.5:3b");
    }
  });
});

describe("classifieur branché sur le modèle choisi", () => {
  it("envoie le modèle lu au moment de la demande, pas celui du démarrage", async () => {
    const classifyIntent = vi.fn(async () => ({ type: "HELP" }));
    const bridge = { classifyIntent } as unknown as NativeBridge;
    let chosen: string | null = "qwen2.5:1.5b";
    const classifier = nativeClassifier(bridge, () => chosen);

    await classifier.classify("aide");
    chosen = "qwen2.5:7b";
    await classifier.classify("aide");

    expect(classifyIntent).toHaveBeenNthCalledWith(1, "aide", "qwen2.5:1.5b");
    expect(classifyIntent).toHaveBeenNthCalledWith(2, "aide", "qwen2.5:7b");
  });

  it("sans modèle choisi, ne contacte pas Ollama et rejette", async () => {
    const classifyIntent = vi.fn(async () => ({ type: "HELP" }));
    const classifier = nativeClassifier({ classifyIntent } as unknown as NativeBridge, () => null);
    await expect(classifier.classify("aide")).rejects.toThrow("aucun modèle choisi");
    expect(classifyIntent).not.toHaveBeenCalled();
  });
});
