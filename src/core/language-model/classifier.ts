import type { NativeBridge } from "../native/bridge";
import type { Classifier } from "./benchmark";

/**
 * Classifieur fourni par le pont natif. La fonction est `async` pour qu'une panne (méthode absente, pont
 * indisponible, modèle non installé) devienne un rejet, que `understandWithModel` traite comme une absence de réponse.
 */
export function nativeClassifier(bridge: NativeBridge): Classifier {
  return {
    classify: async (text: string) => bridge.classifyIntent(text),
  };
}
