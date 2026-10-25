import { BENCHMARK_ORDER, TIERS, type ModelTier, type TierSpec } from "./tiers";

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
 * La carte graphique peut faire tourner le niveau entièrement, en mémoire vidéo. Une carte inconnue n'est jamais
 * comptée comme suffisante.
 */
export function fitsOnGraphicsCard(profile: HardwareProfile, spec: TierSpec): boolean {
  return profile.gpu !== null && profile.gpu.vramGiB >= spec.gpuFullGiB;
}

/** Une carte avec moins de 4 Go de mémoire vidéo (graphique intégré) ne change pas le choix : le processeur compte. */
const MIN_DISCRETE_VRAM_GIB = 4;

/**
 * Niveaux que la machine peut raisonnablement faire tourner, du plus précis au plus léger.
 * - Le niveau précis (14 B) n'est retenu que s'il tient dans la mémoire vidéo, ou sur un processeur puissant avec AVX2 :
 *   sur une carte de 8 Go, il déborde dans la mémoire vive et répond trop lentement (TODO G1).
 * - Le niveau équilibré demande AVX2 quand la carte ne le porte pas entièrement.
 * - Une machine sans AVX2 n'a que le niveau léger : la version CPU des runtimes l'exige pour être utilisable.
 */
export function candidateTiers(profile: HardwareProfile): ModelTier[] {
  return BENCHMARK_ORDER.filter((tier) => {
    const spec = TIERS.find((candidate) => candidate.tier === tier);
    if (!spec || profile.memoryGiB < spec.minMemoryGiB) return false;
    const onCard = fitsOnGraphicsCard(profile, spec);
    const discrete = profile.gpu !== null && profile.gpu.vramGiB >= MIN_DISCRETE_VRAM_GIB;
    if (tier === "precise") return onCard || (!discrete && profile.cores >= PRECISE_MIN_CORES && profile.avx2);
    if (tier === "balanced") return onCard || profile.avx2;
    return true;
  });
}
