import { chooseTier, REFERENCE_CASES, runTierBenchmark, type CaseProgress, type Classifier, type TierResult } from "./benchmark";
import type { NativeBridge } from "../native/bridge";
import { tierSpec, type ModelTier } from "./tiers";

/** Où en est l'installation, pour l'affichage au fil de l'eau. */
export type InstallStage =
  | { kind: "pulling"; model: string; status: string; completed: number | null; total: number | null }
  | { kind: "testing"; model: string; index: number; total: number }
  | { kind: "too-slow"; model: string; result: TierResult };

export interface InstallOptions {
  bridge: Pick<NativeBridge, "classifyIntent" | "pullModel">;
  /** Niveaux à essayer, du plus précis au plus léger. */
  tiers: readonly ModelTier[];
  /** Modèles déjà présents dans Ollama : pas de téléchargement, mais le test a lieu quand même. */
  installed: readonly string[];
  /** Accord explicite avant chaque téléchargement, taille affichée. Refuser arrête l'installation. */
  confirm(model: string, sizeGiB: number): Promise<boolean>;
  onStage(stage: InstallStage): void;
  now?: () => number;
}

export interface InstallOutcome {
  model: string;
  tier: ModelTier;
  result: TierResult;
}

/**
 * Télécharge le modèle recommandé (après accord), le teste avec les phrases de référence, et garde le premier
 * niveau qui passe les limites. Un niveau trop lent ou trop imprécis propose le suivant, après un nouvel accord.
 * Renvoie `null` si aucun niveau ne passe, ou si l'utilisateur refuse un téléchargement : NEXUS reste sur les règles.
 */
export async function installBestModel(options: InstallOptions): Promise<InstallOutcome | null> {
  for (const tier of options.tiers) {
    const spec = tierSpec(tier);
    if (!options.installed.includes(spec.model)) {
      if (!(await options.confirm(spec.model, spec.fileGiB))) return null;
      await options.bridge.pullModel(spec.model, (progress) =>
        options.onStage({
          kind: "pulling",
          model: spec.model,
          status: progress.status,
          completed: progress.completed,
          total: progress.total,
        }),
      );
    }

    const classifier: Classifier = { classify: (text) => options.bridge.classifyIntent(text, spec.model) };
    // Premier appel : il charge le modèle en mémoire, sa durée n'est pas mesurée.
    await classifier.classify(REFERENCE_CASES[0].text).catch(() => undefined);

    const result = await runTierBenchmark(tier, REFERENCE_CASES, classifier, {
      now: options.now,
      onProgress: (progress: CaseProgress) =>
        options.onStage({ kind: "testing", model: spec.model, index: progress.index + 1, total: progress.total }),
    });
    if (chooseTier([result]) === tier) return { model: spec.model, tier, result };
    options.onStage({ kind: "too-slow", model: spec.model, result });
  }
  return null;
}
