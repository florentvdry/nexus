import { candidateTiers, type HardwareProfile } from "./hardware";
import { tierSpec, type ModelTier } from "./tiers";

const STORAGE_KEY = "nexus.model.selected";

/**
 * Modèle que l'utilisateur a choisi, ou `null`. Sans choix, NEXUS reste sur les règles seules : rien n'est utilisé
 * à la place de la décision de l'utilisateur, même si le parcours en recommande un.
 */
export function readSelectedModel(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

export function writeSelectedModel(model: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (model === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, model);
  } catch {
    // Stockage indisponible : le choix reste valable pour la session courante.
  }
}

/** Profils de réglage : chacun correspond à un niveau du modèle (rapide, équilibré, précis). */
export const PROFILE_TIERS = { fast: "light", balanced: "balanced", precise: "precise" } as const satisfies Record<string, ModelTier>;

/**
 * Modèle pour les réponses ouvertes (questions sur le web) : le plus précis installé, sinon le modèle choisi.
 * Les demandes courtes restent sur le modèle choisi, plus rapide.
 */
export function answerModel(installedNames: readonly string[], selected: string | null): string | null {
  for (const tier of ["precise", "balanced"] as const) {
    const model = tierSpec(tier).model;
    if (installedNames.includes(model)) return model;
  }
  return selected;
}

/** Modèle recommandé pour cette machine : celui du niveau le plus précis qu'elle supporte. */
export function recommendedModel(profile: HardwareProfile): string | null {
  const [best] = candidateTiers(profile);
  return best ? tierSpec(best).model : null;
}
