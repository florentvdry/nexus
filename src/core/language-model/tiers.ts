/**
 * Niveaux du modèle de langage local (TODO §1). Les tailles sont des ordres de grandeur, pas des mesures :
 * la taille réelle et la mémoire nécessaire viennent du modèle retenu, une fois sa licence et son support du français vérifiés.
 */
export type ModelTier = "light" | "balanced" | "precise";

export interface TierSpec {
  tier: ModelTier;
  /** Nombre de paramètres, en milliards. */
  parametersBillions: number;
  /** Taille du fichier du modèle, en gigaoctets. */
  fileGiB: number;
  /** Mémoire vive minimale recommandée pour ce niveau, en gigaoctets. */
  minMemoryGiB: number;
}

export const TIERS: readonly TierSpec[] = [
  { tier: "light", parametersBillions: 1, fileGiB: 1, minMemoryGiB: 4 },
  { tier: "balanced", parametersBillions: 3, fileGiB: 2, minMemoryGiB: 8 },
  { tier: "precise", parametersBillions: 7.5, fileGiB: 5, minMemoryGiB: 16 },
];

/** Ordre de test : du plus précis au plus léger. Le premier niveau qui passe le test est gardé. */
export const BENCHMARK_ORDER: readonly ModelTier[] = ["precise", "balanced", "light"];

export function tierSpec(tier: ModelTier): TierSpec {
  const spec = TIERS.find((candidate) => candidate.tier === tier);
  if (!spec) throw new Error(`niveau inconnu : ${tier}`);
  return spec;
}
