import type { NativeBridge } from "../native/bridge";
import type { Classifier } from "./benchmark";

/** Souvenirs donnés au modèle pour une demande : seuls ceux qui s'y rapportent, dans une limite fixe. */
export type MemoriesFor = (query: string) => Promise<string[]>;

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

/**
 * Classifieur NVIDIA NIM, si l'utilisateur l'a activé. La clé n'est pas dans l'interface : le natif la lit depuis son
 * stockage chiffré et rejette la demande si elle n'y est pas. Dans les deux cas, le repli prend le relais.
 */
export function nimClassifier(bridge: NativeBridge, online: () => { model: string } | null, memories: MemoriesFor): Classifier {
  return {
    classify: async (text: string) => {
      const config = online();
      if (!config) throw new Error("NVIDIA NIM non activé");
      return bridge.nimClassify(config.model, text, await memories(text));
    },
  };
}

/** Taille du cache de classifications : une même demande, dans le même contexte, n'est pas reposée au modèle. */
const CLASSIFICATION_CACHE_SIZE = 32;

/**
 * Mémorise les réponses du modèle pour une demande identique (même modèle, même texte, même contexte). Sûr : une
 * réponse en cache ne fait rien par elle-même. Elle passe toujours par la validation, puis par la confirmation.
 * Les échecs ne sont jamais mémorisés.
 */
export class ClassificationCache {
  readonly #entries = new Map<string, unknown>();
  readonly #size: number;

  constructor(size = CLASSIFICATION_CACHE_SIZE) {
    this.#size = size;
  }

  get(key: string): unknown {
    if (!this.#entries.has(key)) return undefined;
    const value = this.#entries.get(key);
    // Un accès remet l'entrée en tête : la plus ancienne non utilisée part en premier.
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: string, value: unknown): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    if (this.#entries.size > this.#size) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
  }

  get length(): number {
    return this.#entries.size;
  }
}

export function nativeClassifier(
  bridge: NativeBridge,
  selectedModel: () => string | null,
  memories: MemoriesFor = async () => [],
  cache = new ClassificationCache(),
): Classifier {
  return {
    classify: async (text: string) => {
      const model = selectedModel();
      if (!model) throw new Error("aucun modèle choisi");
      const context = await memories(text);
      const key = JSON.stringify([model, text, context]);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const value = await bridge.classifyIntent(text, model, context);
      cache.set(key, value);
      return value;
    },
  };
}
