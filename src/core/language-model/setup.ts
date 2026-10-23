import { chooseTier, type TierResult } from "./benchmark";
import { tierSpec, type ModelTier } from "./tiers";

/**
 * Parcours de premier lancement (TODO §1bis). Cette partie ne contient que l'ordre des étapes et le choix du niveau :
 * l'affichage et les appels natifs viendront ensuite. Passer le parcours est toujours possible.
 */
export type SetupStep = "profile" | "mode" | "download" | "benchmark" | "summary" | "skipped";

/** « automatic » laisse le test décider ; les deux autres imposent un niveau. */
export type SetupMode = "automatic" | "faster" | "precise";

const ORDER: readonly SetupStep[] = ["profile", "mode", "download", "benchmark", "summary"];

/** Étape suivante du parcours, ou `summary` une fois le dernier passé. `skipped` est définitif. */
export function nextStep(current: SetupStep): SetupStep {
  if (current === "skipped" || current === "summary") return current;
  const index = ORDER.indexOf(current);
  return ORDER[index + 1] ?? "summary";
}

/** Étape précédente. Le premier pas et le passage restent en place. */
export function previousStep(current: SetupStep): SetupStep {
  if (current === "skipped" || current === "profile") return current;
  const index = ORDER.indexOf(current);
  return ORDER[index - 1] ?? "profile";
}

/** Position d'une étape dans le parcours, pour l'affichage « étape n sur 5 ». Sans effet pour « passé ». */
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

/** Taille et ordre de grandeur du niveau, pour l'étape de choix du mode et le résumé. */
export function describeTier(tier: ModelTier): { parametersBillions: number; fileGiB: number } {
  const spec = tierSpec(tier);
  return { parametersBillions: spec.parametersBillions, fileGiB: spec.fileGiB };
}
