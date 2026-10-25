import { describe, expect, it, vi } from "vitest";

import { ClassificationCache, nativeClassifier } from "./classifier";
import type { NativeBridge } from "../native/bridge";

describe("cache des classifications", () => {
  it("ne repose pas au modèle une demande identique dans le même contexte", async () => {
    const classifyIntent = vi.fn(async () => ({ type: "SYSTEM_INFO" }));
    const bridge = { classifyIntent } as unknown as NativeBridge;
    const classifier = nativeClassifier(bridge, () => "qwen2.5:7b", async () => ["Prénom : Ana"]);
    await classifier.classify("montre le processeur");
    await classifier.classify("montre le processeur");
    expect(classifyIntent).toHaveBeenCalledTimes(1);
  });

  it("repose la question quand le contexte change", async () => {
    const classifyIntent = vi.fn(async () => ({ type: "SYSTEM_INFO" }));
    const bridge = { classifyIntent } as unknown as NativeBridge;
    let context = ["Prénom : Ana"];
    const classifier = nativeClassifier(bridge, () => "qwen2.5:7b", async () => context);
    await classifier.classify("montre le processeur");
    context = ["Prénom : Ana", "Ville : Lyon"];
    await classifier.classify("montre le processeur");
    expect(classifyIntent).toHaveBeenCalledTimes(2);
  });

  it("ne garde jamais un échec", async () => {
    const classifyIntent = vi.fn(async () => {
      throw new Error("Ollama ne répond pas");
    });
    const bridge = { classifyIntent } as unknown as NativeBridge;
    const classifier = nativeClassifier(bridge, () => "qwen2.5:7b");
    await expect(classifier.classify("bonjour")).rejects.toThrow();
    await expect(classifier.classify("bonjour")).rejects.toThrow();
    expect(classifyIntent).toHaveBeenCalledTimes(2);
  });

  it("oublie la plus ancienne entrée quand il est plein", () => {
    const cache = new ClassificationCache(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.length).toBe(2);
  });
});
