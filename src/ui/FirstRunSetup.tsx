import { useEffect, useState } from "react";

import { candidateTiers, type HardwareProfile } from "../core/language-model/hardware";
import { describeTier, nextStep, previousStep, stepNumber, tierForMode, type SetupMode, type SetupStep } from "../core/language-model/setup";
import type { ModelTier } from "../core/language-model/tiers";
import type { NativeBridge } from "../core/native/bridge";
import type { MessageKey } from "../i18n/messages";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

interface FirstRunSetupProps {
  bridge: NativeBridge;
  t: Translate;
  onClose: () => void;
}

const MODES: readonly SetupMode[] = ["automatic", "faster", "precise"];
const MODE_LABEL: Record<SetupMode, MessageKey> = {
  automatic: "setup.mode.automatic",
  faster: "setup.mode.faster",
  precise: "setup.mode.precise",
};
const TIER_LABEL: Record<ModelTier, MessageKey> = {
  light: "tier.light",
  balanced: "tier.balanced",
  precise: "tier.precise",
};

type ProfileState = { status: "loading" } | { status: "ready"; profile: HardwareProfile } | { status: "unavailable" };

/**
 * Parcours de premier lancement (TODO §1bis), ouvert depuis les réglages. Il ne télécharge rien et ne mesure rien :
 * les étapes de téléchargement et de test disent honnêtement qu'elles ne sont pas encore disponibles.
 * Passer le parcours est toujours possible, et NEXUS reste utilisable avec les règles seules.
 */
export function FirstRunSetup({ bridge, t, onClose }: FirstRunSetupProps) {
  const [step, setStep] = useState<SetupStep>("profile");
  const [profile, setProfile] = useState<ProfileState>({ status: "loading" });
  const [mode, setMode] = useState<SetupMode>("automatic");

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
  // Sans mesure de référence, le mode automatique ne retient aucun niveau : les règles restent seules.
  const selected = tierForMode(mode, candidates, []);
  const position = stepNumber(step);
  const finished = step === "summary";

  const modeDisabled = (option: SetupMode): boolean => {
    if (option === "faster") return !candidates.includes("light");
    if (option === "precise") return candidates.length === 0;
    return false;
  };

  const renderBody = () => {
    if (step === "skipped") return <p className="field-hint">{t("setup.skipped")}</p>;

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
            <dd>{machine.gpu ? machine.gpu.name : t("setup.profile.gpuUnknown")}</dd>
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
                {t(MODE_LABEL[option])}
              </label>
            ))}
          </fieldset>
          {profile.status === "ready" && candidates.length === 0 && <p className="field-hint">{t("setup.mode.noTier")}</p>}
          {selected && (
            <p className="field-hint">
              {t("setup.mode.size", {
                size: describeTier(selected).fileGiB,
                params: describeTier(selected).parametersBillions,
              })}
            </p>
          )}
        </>
      );
    }

    if (step === "download") return <p className="field-hint">{t("setup.download.unavailable")}</p>;
    if (step === "benchmark") return <p className="field-hint">{t("setup.benchmark.unavailable")}</p>;

    return selected ? (
      <p>{t("setup.summary.tier", { tier: t(TIER_LABEL[selected]) })}</p>
    ) : (
      <p>{t("setup.summary.rulesOnly")}</p>
    );
  };

  return (
    <div className="setup-overlay" role="dialog" aria-modal="true" aria-label={t("setup.title")}>
      <div className="setup-card">
        <header className="setup-header">
          <h2>{t("setup.title")}</h2>
          {!finished && step !== "skipped" && (
            <button type="button" className="chip" onClick={onClose} aria-label={t("setup.close")}>
              ×
            </button>
          )}
        </header>
        <p className="field-hint">{t("setup.intro")}</p>
        {step !== "skipped" && <p className="field-hint">{t("setup.stepOf", { current: position.index, total: position.total })}</p>}

        {renderBody()}

        <div className="setup-actions">
          {step === "skipped" || finished ? (
            <button type="button" className="send" onClick={onClose}>
              {finished ? t("setup.finish") : t("setup.close")}
            </button>
          ) : (
            <>
              <button type="button" className="chip" onClick={() => setStep("skipped")}>
                {t("setup.skip")}
              </button>
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
