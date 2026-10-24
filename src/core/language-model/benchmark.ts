import type { Intent } from "../intent/parse";
import { BENCHMARK_ORDER, type ModelTier } from "./tiers";
import { validateModelIntent } from "./validate";

/** Une phrase de référence et le type d'intention attendu. Le test mesure le modèle seul, pas les règles. */
export interface ReferenceCase {
  text: string;
  expected: Intent["type"];
}

/** Une vingtaine de phrases, françaises et anglaises, couvrant les intentions les plus courantes. */
export const REFERENCE_CASES: readonly ReferenceCase[] = [
  { text: "peux-tu ouvrir Discord ?", expected: "OPEN_APPLICATION" },
  { text: "lance la calculatrice", expected: "OPEN_APPLICATION" },
  { text: "open the notepad", expected: "OPEN_APPLICATION" },
  { text: "montre-moi l'utilisation du processeur", expected: "SYSTEM_INFO" },
  { text: "combien de mémoire reste-t-il libre ?", expected: "SYSTEM_INFO" },
  { text: "what is my CPU usage", expected: "SYSTEM_INFO" },
  { text: "ferme cette fenêtre", expected: "CLOSE_WINDOW" },
  { text: "ferme toutes les fenêtres", expected: "CLOSE_ALL_WINDOWS" },
  { text: "arrête ce que tu fais", expected: "CANCEL_TASKS" },
  { text: "qu'est-ce que tu sais faire ?", expected: "HELP" },
  { text: "quelles applications tournent en ce moment ?", expected: "PROCESS_LIST" },
  { text: "liste les fenêtres ouvertes", expected: "WINDOW_LIST" },
  { text: "show me the open windows", expected: "WINDOW_LIST" },
  { text: "ferme la fenêtre Discord", expected: "WINDOW_CLOSE" },
  { text: "cherche mes PDF téléchargés cette semaine", expected: "FILE_SEARCH" },
  { text: "analyse le domaine example.com", expected: "OSINT_DOMAIN" },
  { text: "renomme le fichier a.txt en b.txt", expected: "FILE_RENAME" },
  { text: "rename report.pdf to final.pdf", expected: "FILE_RENAME" },
  { text: "supprime le fichier vieux.txt", expected: "FILE_TRASH" },
  { text: "déplace notes.txt dans Archives", expected: "FILE_MOVE" },
  { text: "quels plugins sont installés ?", expected: "PLUGIN_LIST" },
  { text: "lance Claude Code dans mon projet", expected: "AGENT_RUN" },
];

/** Un classifieur : texte en entrée, JSON brut en sortie (validé ensuite, jamais exécuté tel quel). */
export interface Classifier {
  classify(text: string, signal?: AbortSignal): Promise<unknown>;
}

export interface BenchmarkLimits {
  /** Temps moyen maximal par phrase, en secondes (TODO §1 : ≈ 3 s). */
  maxSecondsPerSentence: number;
  /** Part minimale de phrases correctes, entre 0 et 1. */
  minSuccessRatio: number;
}

/**
 * Le test ne refuse plus un modèle pour sa justesse (minimum retiré) : il mesure, et l'installation le retient s'il
 * répond à temps. Seule la vitesse décide de passer au niveau suivant, plus léger.
 */
export const DEFAULT_LIMITS: BenchmarkLimits = { maxSecondsPerSentence: 3, minSuccessRatio: 0 };

export interface TierResult {
  tier: ModelTier;
  passed: number;
  total: number;
  averageSeconds: number;
}

export interface CaseProgress {
  tier: ModelTier;
  index: number;
  total: number;
  text: string;
  correct: boolean;
  seconds: number;
}

export interface BenchmarkOptions {
  /** Horloge injectée pour les tests. */
  now?: () => number;
  /** Chaque phrase s'affiche au fil de l'eau (TODO §1bis : temps et réussite). */
  onProgress?: (progress: CaseProgress) => void;
}

/** Fait passer toutes les phrases de référence par un niveau et mesure la réussite et le temps moyen. */
export async function runTierBenchmark(
  tier: ModelTier,
  cases: readonly ReferenceCase[],
  classifier: Classifier,
  options: BenchmarkOptions = {},
): Promise<TierResult> {
  const now = options.now ?? (() => performance.now());
  let passed = 0;
  let totalSeconds = 0;

  for (const [index, reference] of cases.entries()) {
    const started = now();
    let correct = false;
    try {
      const intent = validateModelIntent(await classifier.classify(reference.text));
      correct = intent !== null && intent.type === reference.expected;
    } catch {
      correct = false;
    }
    const seconds = (now() - started) / 1000;
    totalSeconds += seconds;
    if (correct) passed += 1;
    options.onProgress?.({ tier, index, total: cases.length, text: reference.text, correct, seconds });
  }

  return {
    tier,
    passed,
    total: cases.length,
    averageSeconds: cases.length === 0 ? 0 : totalSeconds / cases.length,
  };
}

/**
 * Garde le niveau le plus précis qui respecte les deux limites. `null` : aucun niveau ne passe, NEXUS reste
 * sur les règles seules (TODO §1, « Sans modèle, NEXUS ne doit pas devenir inutilisable »).
 */
export function chooseTier(results: readonly TierResult[], limits: BenchmarkLimits = DEFAULT_LIMITS): ModelTier | null {
  for (const tier of BENCHMARK_ORDER) {
    const result = results.find((candidate) => candidate.tier === tier);
    if (!result || result.total === 0) continue;
    const fastEnough = result.averageSeconds <= limits.maxSecondsPerSentence;
    const accurateEnough = result.passed / result.total >= limits.minSuccessRatio;
    if (fastEnough && accurateEnough) return tier;
  }
  return null;
}
