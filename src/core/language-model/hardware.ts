import { BENCHMARK_ORDER, TIERS, type ModelTier } from "./tiers";

/** Profil de la machine, lu par le natif puis affiché tel quel dans l'assistant de premier lancement (TODO §1bis). */
export interface HardwareProfile {
  memoryGiB: number;
  cores: number;
  avx2: boolean;
  /** Carte graphique, si elle est détectée. `null` = inconnue : ne bloque pas le choix, mais aucun niveau n'en profite. */
  gpu: { name: string; vramGiB: number } | null;
}

/** Cœurs minimaux pour le niveau le plus précis : en dessous, le temps limite n'est pas tenable en pratique. */
const PRECISE_MIN_CORES = 8;

/**
 * Niveaux que la machine peut raisonnablement faire tourner, du plus précis au plus léger.
 * Une machine sans AVX2 n'a que le niveau léger : la version CPU des runtimes l'exige pour être utilisable.
 */
export function candidateTiers(profile: HardwareProfile): ModelTier[] {
  return BENCHMARK_ORDER.filter((tier) => {
    const spec = TIERS.find((candidate) => candidate.tier === tier);
    if (!spec || profile.memoryGiB < spec.minMemoryGiB) return false;
    if (tier === "precise") return profile.cores >= PRECISE_MIN_CORES && profile.avx2;
    if (tier === "balanced") return profile.avx2;
    return true;
  });
}
