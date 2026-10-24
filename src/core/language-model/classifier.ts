import type { NativeBridge } from "../native/bridge";
import type { Classifier } from "./benchmark";

/**
 * Classifieur fourni par Ollama, via le pont natif. Le modèle est lu au moment de chaque demande : un changement de
 * choix dans les réglages prend effet tout de suite. Les souvenirs de l'utilisateur accompagnent la demande, pour
 * qu'elle se comprenne (« mon navigateur »). Sans modèle choisi, ou si Ollama ne répond pas, la fonction rejette ;
 * `understandWithModel` traite le rejet comme une absence de réponse et garde les règles.
 */
/** Essaie le premier classifieur ; en cas d'échec (quota, réseau, clé), le second prend le relais. */
export function fallbackClassifier(primary: Classifier, fallback: Classifier): Classifier {
  return {
    classify: async (text: string, signal?: AbortSignal) => {
      try {
        return await primary.classify(text, signal);
      } catch {
        return fallback.classify(text, signal);
      }
    },
  };
}

/** Classifieur NVIDIA NIM, si une clé est enregistrée. Sans clé, il rejette : le repli prend alors le relais. */
export function nimClassifier(bridge: NativeBridge, online: () => { key: string; model: string } | null, memories: () => Promise<string[]>): Classifier {
  return {
    classify: async (text: string) => {
      const config = online();
      if (!config) throw new Error("NVIDIA NIM non configuré");
      return bridge.nimClassify(config.key, config.model, text, await memories());
    },
  };
}

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
