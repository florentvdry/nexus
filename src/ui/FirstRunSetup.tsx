import { useEffect, useState } from "react";

import { candidateTiers, type HardwareProfile } from "../core/language-model/hardware";
import type { InstallOutcome } from "../core/language-model/install";
import { describeTier, nextStep, previousStep, stepNumber, type SetupMode, type SetupStep } from "../core/language-model/setup";
import { tierSpec, type ModelTier } from "../core/language-model/tiers";
import type { NativeBridge } from "../core/native/bridge";
import type { MessageKey } from "../i18n/messages";
import { ModelInstaller } from "./ModelInstaller";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

interface FirstRunSetupProps {
  bridge: NativeBridge;
  t: Translate;
  /** Appelé seulement quand le modèle est prêt (ou quand la machine ne peut en faire tourner aucun). */
  onClose: () => void;
}

const MODES: readonly SetupMode[] = ["automatic", "faster", "precise"];
const MODE_LABEL: Record<SetupMode, MessageKey> = {
  automatic: "setup.mode.automatic",
  faster: "setup.mode.faster",
  precise: "setup.mode.precise",
};

type ProfileState = { status: "loading" } | { status: "ready"; profile: HardwareProfile } | { status: "unavailable" };

/**
 * Parcours de premier lancement : profil, mode, puis installation (Ollama, téléchargement, test). Il n'y a pas de
 * bouton pour passer ni pour fermer : tant que le modèle n'est pas prêt, l'application n'est pas accessible.
 */
export function FirstRunSetup({ bridge, t, onClose }: FirstRunSetupProps) {
  const [step, setStep] = useState<SetupStep>("profile");
  const [profile, setProfile] = useState<ProfileState>({ status: "loading" });
  const [mode, setMode] = useState<SetupMode>("automatic");
  const [outcome, setOutcome] = useState<InstallOutcome | null>(null);
  const [installDone, setInstallDone] = useState(false);
  // Incrémenté à chaque nouvelle tentative : l'installeur repart de zéro.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    bridge
      .hardwareProfile()
      .then((value) => {
        if (current) setProfile({ status: "ready", profile: value });
      })
      .catch(() => {
        if (current) setProfile({ status: "unavailable" });
      });
    return () => {
      current = false;
    };
  }, [bridge]);

  const candidates = profile.status === "ready" ? candidateTiers(profile.profile) : [];
  // Niveaux à installer et tester, du plus précis au plus léger, selon le mode : « plus rapide » ne teste que le léger.
  const plannedTiers: ModelTier[] =
    mode === "faster" ? candidates.filter((tier) => tier === "light") : mode === "precise" ? candidates.slice(0, 1) : candidates;
  const position = stepNumber(step);

  const modeDisabled = (option: SetupMode): boolean => {
    if (option === "faster") return !candidates.includes("light");
    if (option === "precise") return candidates.length === 0;
    return false;
  };

  const retry = () => {
    setOutcome(null);
    setInstallDone(false);
    setAttempt((count) => count + 1);
  };

  const renderBody = () => {
    if (step === "profile") {
      if (profile.status === "loading") return <p className="field-hint">{t("setup.loading")}</p>;
      if (profile.status === "unavailable") return <p className="field-hint">{t("setup.unavailable")}</p>;
      const machine = profile.profile;
      return (
        <dl className="info-card">
          <div>
            <dt>{t("setup.profile.memory")}</dt>
            <dd>
              {machine.memoryGiB.toFixed(1)} {t("setup.unit.gib")}
            </dd>
          </div>
          <div>
            <dt>{t("setup.profile.cores")}</dt>
            <dd>{machine.cores}</dd>
          </div>
          <div>
            <dt>{t("setup.profile.avx2")}</dt>
            <dd>{machine.avx2 ? t("setup.profile.yes") : t("setup.profile.no")}</dd>
          </div>
          <div>
            <dt>{t("setup.profile.gpu")}</dt>
            <dd>
              {machine.gpu
                ? `${machine.gpu.name} · ${machine.gpu.vramGiB.toFixed(1)} ${t("setup.unit.gib")}`
                : t("setup.profile.gpuUnknown")}
            </dd>
          </div>
        </dl>
      );
    }

    if (step === "mode") {
      return (
        <>
          <fieldset className="setup-options">
            {MODES.map((option) => (
              <label key={option} className="field toggle">
                <input
                  type="radio"
                  name="setup-mode"
                  value={option}
                  checked={mode === option}
                  disabled={modeDisabled(option)}
                  onChange={() => setMode(option)}
                />
                <span>{t(MODE_LABEL[option])}</span>
              </label>
            ))}
          </fieldset>
          {profile.status === "ready" && candidates.length === 0 && <p className="field-hint">{t("setup.mode.noTier")}</p>}
          {plannedTiers.length > 0 && (
            <p className="field-hint">
              {t("install.plan", { model: tierSpec(plannedTiers[0]).model, size: tierSpec(plannedTiers[0]).fileGiB })}
            </p>
          )}
          {plannedTiers.length > 0 && (
            <p className="field-hint">
              {t("setup.mode.size", {
                size: describeTier(plannedTiers[0]).fileGiB,
                params: describeTier(plannedTiers[0]).parametersBillions,
              })}
            </p>
          )}
        </>
      );
    }

    // Installation : démarre seule à l'ouverture de l'étape. L'accord a été donné sur la page précédente.
    if (plannedTiers.length === 0) return <p className="field-hint">{t("setup.download.none")}</p>;
    return (
      <ModelInstaller
        key={attempt}
        bridge={bridge}
        t={t}
        tiers={plannedTiers}
        autoStart
        onFinish={(result) => {
          setOutcome(result);
          setInstallDone(true);
        }}
      />
    );
  };

  /** « Commencer » seulement quand le modèle est prêt, ou quand la machine ne peut en faire tourner aucun. */
  const canStart = step === "download" && (outcome !== null || (installDone === false && plannedTiers.length === 0));

  return (
    <div className="setup-overlay" role="dialog" aria-modal="true" aria-label={t("setup.title")}>
      <div className="setup-card">
        <header className="setup-header">
          <h2>{t("setup.title")}</h2>
        </header>
        <p className="field-hint">{t("setup.intro")}</p>
        <p className="field-hint">{t("setup.stepOf", { current: position.index, total: position.total })}</p>

        {renderBody()}

        <div className="setup-actions">
          {step === "download" ? (
            canStart ? (
              <button type="button" className="send" onClick={onClose}>
                {t("setup.start")}
              </button>
            ) : installDone ? (
              <button type="button" className="send" onClick={retry}>
                {t("install.retry")}
              </button>
            ) : null
          ) : (
            <>
              {step !== "profile" && (
                <button type="button" className="chip" onClick={() => setStep((current) => previousStep(current))}>
                  {t("setup.back")}
                </button>
              )}
              <button
                type="button"
                className="send"
                disabled={step === "profile" && profile.status === "loading"}
                onClick={() => setStep((current) => nextStep(current))}
              >
                {t("setup.next")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
