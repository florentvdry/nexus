import { vi } from "vitest";

import { UnavailableNativeBridge, type NativeBridge } from "../native/bridge";

/** Modèle local, dans les tests : le nom d'un modèle choisi, comme le donnent les réglages. */
export const TEST_MODEL = "qwen2.5:7b";

/**
 * Pont SIMULÉ pour les tests : le « modèle » répond selon une table (demande → intention JSON), sans Ollama. Une
 * demande absente de la table fait échouer le modèle : chaque phrase envoyée par un test doit être prévue.
 * Le registre de souvenirs est vide ; les autres appels passent par `overrides`.
 */
export function scriptedBridge(answers: Record<string, unknown>, overrides: Partial<NativeBridge> = {}): NativeBridge {
  const bridge = new UnavailableNativeBridge();
  return Object.assign(bridge, {
    classifyIntent: vi.fn(async (text: string) => {
      if (!(text in answers)) throw new Error(`réponse du modèle non prévue par le test : ${text}`);
      return answers[text];
    }),
    memoryList: vi.fn(async () => []),
    ...overrides,
  }) as unknown as NativeBridge;
}
