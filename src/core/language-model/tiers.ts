/**
 * Niveaux du modèle de langage local (TODO §1). Le modèle est servi par Ollama, sur ce poste. Chaque niveau propose
 * un modèle recommandé, mais l'utilisateur choisit celui qui répond, parmi ceux qu'il a installés (voir `selection.ts`).
 *
 * Licences vérifiées : Qwen2.5 1,5 B, 7 B et 14 B sont sous Apache 2.0 ; la taille 3 B est sous une licence Qwen à part,
 * donc écartée. Le français est supporté par la famille Qwen2.5.
 */
export type ModelTier = "light" | "balanced" | "precise";

export interface TierSpec {
  tier: ModelTier;
  /** Modèle Ollama recommandé pour ce niveau. */
  model: string;
  /** Nombre de paramètres, en milliards. */
  parametersBillions: number;
  /** Taille approximative du modèle téléchargé par Ollama, en gigaoctets. */
  fileGiB: number;
  /** Mémoire vive minimale recommandée pour ce niveau, en gigaoctets. */
  minMemoryGiB: number;
}

export const TIERS: readonly TierSpec[] = [
  { tier: "light", model: "qwen2.5:1.5b", parametersBillions: 1.5, fileGiB: 1, minMemoryGiB: 4 },
  { tier: "balanced", model: "qwen2.5:7b", parametersBillions: 7, fileGiB: 5, minMemoryGiB: 8 },
  { tier: "precise", model: "qwen2.5:14b", parametersBillions: 14, fileGiB: 9, minMemoryGiB: 16 },
];

/** Ordre de test : du plus précis au plus léger. Le premier niveau qui passe le test est gardé. */
export const BENCHMARK_ORDER: readonly ModelTier[] = ["precise", "balanced", "light"];

export function tierSpec(tier: ModelTier): TierSpec {
  const spec = TIERS.find((candidate) => candidate.tier === tier);
  if (!spec) throw new Error(`niveau inconnu : ${tier}`);
  return spec;
}
