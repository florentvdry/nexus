import { chooseTier, type TierResult } from "./benchmark";
import { tierSpec, type ModelTier } from "./tiers";

/**
 * Parcours de premier lancement : trois étapes. Profil de la machine, choix du mode, puis installation (Ollama,
 * téléchargement, test) dont la fin débloque l'application. Il n'y a pas d'étape pour passer : tant que le modèle
 * n'est pas prêt, l'application n'est pas accessible.
 */
export type SetupStep = "profile" | "mode" | "download";

/** « automatic » laisse le test décider ; les deux autres imposent un niveau. */
export type SetupMode = "automatic" | "faster" | "precise";

const ORDER: readonly SetupStep[] = ["profile", "mode", "download"];

/** Étape suivante. La dernière étape reste la dernière : c'est là que l'installation se termine. */
export function nextStep(current: SetupStep): SetupStep {
  const index = ORDER.indexOf(current);
  return ORDER[index + 1] ?? current;
}

/** Étape précédente. Le premier pas reste en place. */
export function previousStep(current: SetupStep): SetupStep {
  const index = ORDER.indexOf(current);
  return ORDER[index - 1] ?? current;
}

/** Position d'une étape dans le parcours, pour l'affichage « étape n sur 3 ». */
export function stepNumber(current: SetupStep): { index: number; total: number } {
  return { index: ORDER.indexOf(current) + 1, total: ORDER.length };
}

/**
 * Niveau retenu selon le mode. `null` : aucun niveau utilisable, NEXUS reste sur les règles seules.
 * Le mode manuel n'impose un niveau que s'il est disponible sur la machine.
 */
export function tierForMode(mode: SetupMode, candidates: readonly ModelTier[], results: readonly TierResult[]): ModelTier | null {
  if (mode === "automatic") return chooseTier(results);
  if (mode === "faster") return candidates.includes("light") ? "light" : null;
  return candidates[0] ?? null;
}

/** Taille et ordre de grandeur du niveau, pour l'étape de choix du mode. */
export function describeTier(tier: ModelTier): { parametersBillions: number; fileGiB: number } {
  const spec = tierSpec(tier);
  return { parametersBillions: spec.parametersBillions, fileGiB: spec.fileGiB };
}
