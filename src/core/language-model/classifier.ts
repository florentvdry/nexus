import type { NativeBridge } from "../native/bridge";
import type { Classifier } from "./benchmark";

/**
 * Classifieur fourni par Ollama, via le pont natif. Le modèle est lu au moment de chaque demande : un changement de
 * choix dans les réglages prend effet tout de suite. Les souvenirs de l'utilisateur accompagnent la demande, pour
 * qu'elle se comprenne (« mon navigateur »). Sans modèle choisi, ou si Ollama ne répond pas, la fonction rejette ;
 * `understandWithModel` traite le rejet comme une absence de réponse et garde les règles.
 */
export function nativeClassifier(
  bridge: NativeBridge,
  selectedModel: () => string | null,
  memories: () => Promise<string[]> = async () => [],
): Classifier {
  return {
    classify: async (text: string) => {
      const model = selectedModel();
      if (!model) throw new Error("aucun modèle choisi");
      return bridge.classifyIntent(text, model, await memories());
    },
  };
}
