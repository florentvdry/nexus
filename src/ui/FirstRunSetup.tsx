import { useEffect, useState, type ReactNode } from "react";

import { candidateTiers, type HardwareProfile } from "../core/language-model/hardware";
import type { InstallOutcome } from "../core/language-model/install";
import { describeTier, nextStep, previousStep, type SetupMode, type SetupStep } from "../core/language-model/setup";
import { tierSpec, type ModelTier } from "../core/language-model/tiers";
import type { NativeBridge } from "../core/native/bridge";
import type { MessageKey } from "../i18n/messages";
import { ModelInstaller } from "./ModelInstaller";
import { Orb } from "./Orb";
import { ArrowRightIcon, BoltIcon, CheckIcon, SparkIcon, TargetIcon } from "./icons";

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
const MODE_HINT: Record<SetupMode, MessageKey> = {
  automatic: "setup.mode.automaticHint",
  faster: "setup.mode.fasterHint",
  precise: "setup.mode.preciseHint",
};
const MODE_ICON: Record<SetupMode, typeof SparkIcon> = {
  automatic: SparkIcon,
  faster: BoltIcon,
  precise: TargetIcon,
};
/** Les trois étapes affichées en haut de page, dans l'ordre du parcours. */
const STEPS: { id: SetupStep; label: MessageKey }[] = [
  { id: "profile", label: "setup.step.profile" },
  { id: "mode", label: "setup.step.mode" },
  { id: "download", label: "setup.step.install" },
];

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
  const stepIndex = STEPS.findIndex((item) => item.id === step);

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

  const stepTitle: Record<SetupStep, MessageKey> = {
    profile: "setup.profile.title",
    mode: "setup.modeQuestion",
    download: "setup.download.title",
  };

  const renderBody = (): ReactNode => {
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
          <p className="field-hint">{t("setup.modeHint")}</p>
          <div role="radiogroup" aria-label={t("setup.mode.title")} className="choices">
            {MODES.map((option) => {
              const checked = mode === option;
              const Icon = MODE_ICON[option];
              return (
                <label key={option} className={`choice${checked ? " selected" : ""}`}>
                  <input
                    type="radio"
                    name="setup-mode"
                    value={option}
                    checked={checked}
                    disabled={modeDisabled(option)}
                    onChange={() => setMode(option)}
                  />
                  <span className="choice-icon" data-tone={option} aria-hidden="true">
                    <Icon size={21} />
                  </span>
                  <span className="choice-text">
                    <span className="choice-title">
                      {t(MODE_LABEL[option])}
                      {option === "automatic" && <span className="badge">{t("setup.mode.recommended")}</span>}
                    </span>
                    <span className="choice-hint">{t(MODE_HINT[option])}</span>
                  </span>
                  <span className="choice-dot" aria-hidden="true">
                    {checked && <CheckIcon size={12} />}
                  </span>
                </label>
              );
            })}
          </div>
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
    <div className="setup-screen" role="dialog" aria-modal="true" aria-label={t("setup.title")}>
      <div className="setup-column">
        <Orb state="idle" size="medium" />
        <h1>{t("setup.welcome")}</h1>
        <p className="setup-lead">{t("setup.welcomeIntro")}</p>

        <ol className="stepper" aria-label={t("setup.title")}>
          {STEPS.map((item, index) => {
            const done = index < stepIndex;
            const current = index === stepIndex;
            return (
              <li key={item.id} className="stepper-item" aria-current={current ? "step" : undefined} data-state={done ? "done" : current ? "current" : "todo"}>
                <span className="stepper-badge">{done ? <CheckIcon size={14} /> : index + 1}</span>
                <span>{t(item.label)}</span>
              </li>
            );
          })}
        </ol>

        <section className="setup-card">
          <h2>{t(stepTitle[step])}</h2>
          {step === "profile" && <p className="field-hint">{t("setup.intro")}</p>}

          {renderBody()}

          <div className="setup-actions">
            {step === "download" ? (
              canStart ? (
                <button type="button" className="primary-button" onClick={onClose}>
                  {t("setup.start")}
                </button>
              ) : installDone ? (
                <button type="button" className="primary-button" onClick={retry}>
                  {t("install.retry")}
                </button>
              ) : null
            ) : (
              <>
                {step !== "profile" && (
                  <button type="button" className="ghost-button" onClick={() => setStep((current) => previousStep(current))}>
                    {t("setup.back")}
                  </button>
                )}
                <button
                  type="button"
                  className="primary-button"
                  disabled={step === "profile" && profile.status === "loading"}
                  onClick={() => setStep((current) => nextStep(current))}
                >
                  {step === "mode" ? t("setup.install") : t("setup.next")}
                  {step === "mode" && <ArrowRightIcon size={16} />}
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
