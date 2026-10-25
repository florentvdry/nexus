import { useEffect, useRef, useState } from "react";

import { installBestModel, type InstallOutcome, type InstallStage } from "../core/language-model/install";
import type { OllamaStatus } from "../core/language-model/ollama";
import { writeSelectedModel } from "../core/language-model/selection";
import type { ModelTier } from "../core/language-model/tiers";
import type { NativeBridge } from "../core/native/bridge";
import type { MessageKey } from "../i18n/messages";
import { Orb } from "./Orb";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Avancement global : téléchargement de 0 à 70 %, test de 70 à 100 %. `null` tant que la durée est inconnue
 * (installation d'Ollama) : on affiche alors un message, pas un pourcentage inventé.
 */
export function installPercent(stage: InstallStage | null, done: boolean): number | null {
  if (done) return 100;
  if (!stage) return null;
  if (stage.kind === "pulling") {
    return stage.completed !== null && stage.total !== null && stage.total > 0 ? Math.round((stage.completed / stage.total) * 70) : 0;
  }
  if (stage.kind === "testing") return 70 + Math.round((stage.index / stage.total) * 30);
  return 70;
}

interface ModelInstallerProps {
  bridge: NativeBridge;
  t: Translate;
  /** Niveaux à essayer, du plus précis au plus léger, selon le mode choisi. */
  tiers: readonly ModelTier[];
  onFinish: (outcome: InstallOutcome | null) => void;
  /**
   * Parcours automatique : l'installation démarre seule à l'ouverture de l'étape. L'accord a été donné en validant
   * la page qui annonce ce qui sera installé (Ollama si besoin, le modèle, sa taille). Aucun clic supplémentaire.
   */
  autoStart?: boolean;
}

type Phase =
  | "idle"
  | "checking"
  | "needsOllama"
  | "installingOllama"
  | "unreachable"
  | "running"
  | "done"
  | "failed";

interface PendingConsent {
  model: string;
  sizeGiB: number;
  resolve: (accepted: boolean) => void;
}

/**
 * Installation dans le parcours : Ollama est installé s'il manque, le modèle est téléchargé, puis testé avec des phrases
 * de référence. Le modèle qui passe est sélectionné ; il reste modifiable dans les réglages. Pendant tout le travail,
 * l'orbe reste en réflexion.
 */
export function ModelInstaller({ bridge, t, tiers, onFinish, autoStart = false }: ModelInstallerProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [ollamaStage, setOllamaStage] = useState<string | null>(null);
  const [stage, setStage] = useState<InstallStage | null>(null);
  const [pending, setPending] = useState<PendingConsent | null>(null);
  const [outcome, setOutcome] = useState<InstallOutcome | null>(null);
  const [message, setMessage] = useState("");
  // StrictMode exécute les effets deux fois en développement : une seule installation doit partir.
  const started = useRef(false);

  const finish = (result: InstallOutcome | null) => {
    setOutcome(result);
    setPhase("done");
    onFinish(result);
  };

  // Un échec reste affiché avec sa cause et un bouton « Réessayer » : ce n'est pas un résultat « aucun modèle ».
  const fail = (error: unknown) => {
    setMessage(error instanceof Error ? error.message : String(error));
    setPhase("failed");
  };

  const runModels = async (status: OllamaStatus) => {
    setPhase("running");
    try {
      const result = await installBestModel({
        bridge,
        tiers,
        installed: status.models.map((model) => model.name),
        // Parcours automatique : l'accord global a été donné. Sinon, chaque téléchargement demande confirmation.
        confirm: autoStart ? async () => true : (model, sizeGiB) => new Promise<boolean>((resolve) => setPending({ model, sizeGiB, resolve })),
        onStage: setStage,
      });
      if (result) writeSelectedModel(result.model);
      finish(result);
    } catch (error) {
      fail(error);
    }
  };

  const installOllama = async () => {
    setPhase("installingOllama");
    setOllamaStage("installing");
    try {
      await bridge.installOllama(setOllamaStage);
    } catch (error) {
      fail(error);
      return;
    }
    const status = await readStatus(bridge);
    if (!status?.reachable) {
      setPhase("unreachable");
      return;
    }
    await runModels(status);
  };

  const start = async () => {
    setPhase("checking");
    const status = await readStatus(bridge);
    if (!status) {
      setPhase("unreachable");
      return;
    }
    if (!status.reachable) {
      if (autoStart) {
        await installOllama();
        return;
      }
      setPhase("needsOllama");
      return;
    }
    await runModels(status);
  };

  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void start();
    // Démarrage unique à l'ouverture de l'étape ; `start` lit toujours l'état courant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const answer = (accepted: boolean) => {
    if (!pending) return;
    pending.resolve(accepted);
    setPending(null);
  };

  const busy = phase === "checking" || phase === "installingOllama" || phase === "running";
  const percent = phase === "failed" || phase === "unreachable" ? null : installPercent(stage, phase === "done");

  return (
    <div className="model-installer">
      <p className="field-hint">{t("install.description")}</p>

      {/* Dès que l'installation démarre (ou va démarrer), l'orbe tourne avec le libellé : jamais un écran muet. */}
      {(busy || (autoStart && phase === "idle")) && (
        <div className="installer-orb" aria-live="polite">
          <Orb state="thinking" size="medium" />
          <p className="field-hint" role="status">{t("install.loading")}</p>
        </div>
      )}

      {percent !== null && (
        <div className="installer-progress">
          <progress value={percent} max={100} aria-label={t("install.progressLabel")} />
          <p className="field-hint">{percent} %</p>
        </div>
      )}

      {phase === "idle" && (
        <button type="button" className="primary-button" onClick={() => void start()}>
          {t("install.start")}
        </button>
      )}

      {phase === "checking" && <p className="field-hint">{t("install.checking")}</p>}

      {phase === "needsOllama" && (
        <div className="setup-actions">
          <p>{t("install.ollamaMissing")}</p>
          <button type="button" className="send" onClick={() => void installOllama()}>
            {t("install.installOllama")}
          </button>
          <button type="button" className="chip" onClick={() => finish(null)}>
            {t("install.stop")}
          </button>
        </div>
      )}

      {phase === "installingOllama" && (
        <p className="field-hint">
          {ollamaStage === "starting"
            ? t("install.ollamaStarting")
            : ollamaStage === "ready"
              ? t("install.ollamaReady")
              : t("install.ollamaInstalling")}
        </p>
      )}

      {phase === "unreachable" && (
        <>
          <p className="field-hint">{t("model.unreachable")}</p>
          <button type="button" className="chip" onClick={() => void start()}>
            {t("install.retry")}
          </button>
        </>
      )}

      {phase === "running" &&
        (pending ? (
          <div className="setup-actions">
            <p>{t("install.confirm", { model: pending.model, size: pending.sizeGiB })}</p>
            <button type="button" className="send" onClick={() => answer(true)}>
              {t("install.download")}
            </button>
            <button type="button" className="chip" onClick={() => answer(false)}>
              {t("install.stop")}
            </button>
          </div>
        ) : (
          stage && <StageLine stage={stage} t={t} />
        ))}

      {phase === "done" && <p>{outcome ? t("install.ready", { model: outcome.model }) : t("install.none")}</p>}

      {phase === "failed" && (
        <>
          <p className="field-hint">{t("install.failed", { message })}</p>
          <button type="button" className="chip" onClick={() => void start()}>
            {t("install.retry")}
          </button>
        </>
      )}
    </div>
  );
}

/** Statut d'Ollama, ou `null` si le pont ne répond pas : jamais d'exception ici. */
async function readStatus(bridge: NativeBridge): Promise<OllamaStatus | null> {
  return Promise.resolve()
    .then(() => bridge.ollamaStatus())
    .catch(() => null);
}

function StageLine({ stage, t }: { stage: InstallStage; t: Translate }) {
  if (stage.kind === "pulling") {
    return <p className="field-hint">{t("install.pulling", { model: stage.model, status: stage.status })}</p>;
  }
  if (stage.kind === "testing") {
    return <p className="field-hint">{t("install.testing", { model: stage.model, index: stage.index, total: stage.total })}</p>;
  }
  return <p className="field-hint">{t("install.slow", { model: stage.model })}</p>;
}
