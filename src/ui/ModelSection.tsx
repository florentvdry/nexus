import { useCallback, useEffect, useState } from "react";

import { candidateTiers, type HardwareProfile } from "../core/language-model/hardware";
import { type OllamaStatus } from "../core/language-model/ollama";
import { readSelectedModel, recommendedModel, writeSelectedModel } from "../core/language-model/selection";
import type { NativeBridge } from "../core/native/bridge";
import type { MessageKey } from "../i18n/messages";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

interface ModelSectionProps {
  bridge: NativeBridge;
  t: Translate;
  /** Change quand le parcours a pu modifier le modèle : la section relit alors le choix et le statut. */
  revision?: number;
}

const GIB = 1024 * 1024 * 1024;

/**
 * Modèle de langage dans les réglages : le modèle utilisé est toujours affiché, et l'utilisateur le choisit
 * parmi ceux qu'Ollama a installés. Le modèle recommandé est signalé, jamais imposé.
 */
export function ModelSection({ bridge, t, revision = 0 }: ModelSectionProps) {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [profile, setProfile] = useState<HardwareProfile | null>(null);
  const [selected, setSelected] = useState<string | null>(() => readSelectedModel());
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await bridge.ollamaStatus());
    } catch {
      setUnavailable(true);
    }
  }, [bridge]);

  useEffect(() => {
    let current = true;
    setSelected(readSelectedModel());
    void refresh();
    bridge
      .hardwareProfile()
      .then((value) => {
        if (current) setProfile(value);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [bridge, refresh, revision]);

  const recommended = profile && candidateTiers(profile).length > 0 ? recommendedModel(profile) : null;
  const installed = status?.models ?? [];
  const selectedIsInstalled = selected !== null && installed.some((model) => model.name === selected);

  const choose = (model: string | null) => {
    writeSelectedModel(model);
    setSelected(model);
  };

  return (
    <section className="journal model" aria-label={t("model.title")}>
      <h3>{t("model.title")}</h3>
      {unavailable ? (
        <p className="field-hint">{t("setup.unavailable")}</p>
      ) : (
        <>
          <p className="field-hint">
            {selected === null
              ? t("model.used.none")
              : t("model.used", { model: selected }) + (status?.reachable && !selectedIsInstalled ? ` ${t("model.notInstalled")}` : "")}
          </p>

          {status && !status.reachable && <p className="field-hint">{t("model.unreachable")}</p>}

          <fieldset className="setup-options">
            <label className="field toggle">
              <input type="radio" name="model-choice" checked={selected === null} onChange={() => choose(null)} />
              {t("model.none")}
            </label>
            {installed.map((model) => (
              <label key={model.name} className="field toggle">
                <input type="radio" name="model-choice" checked={selected === model.name} onChange={() => choose(model.name)} />
                {model.name}
                {model.parameterSize ? ` · ${model.parameterSize}` : ""}
                {` · ${(model.sizeBytes / GIB).toFixed(1)} ${t("setup.unit.gib")}`}
                {model.name === recommended ? ` · ${t("model.recommended")}` : ""}
              </label>
            ))}
          </fieldset>

          {status?.reachable && recommended && !installed.some((model) => model.name === recommended) && (
            <p className="field-hint">
              {t("model.pullHint")} <code>ollama pull {recommended}</code>
            </p>
          )}

          <button type="button" className="chip" onClick={() => void refresh()}>
            {t("model.refresh")}
          </button>
        </>
      )}
    </section>
  );
}
