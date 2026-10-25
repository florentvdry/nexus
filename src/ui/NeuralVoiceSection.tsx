import { useEffect, useState } from "react";

import type { NativeBridge } from "../core/native/bridge";
import type { MessageKey } from "../i18n/messages";

/** Langues de l'interface, chacune avec sa voix naturelle. */
const LANGUAGES = [
  { locale: "fr", label: "Français" },
  { locale: "en", label: "English" },
] as const;

interface NeuralVoiceSectionProps {
  bridge: NativeBridge;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/**
 * Voix naturelle, par langue. Le téléchargement ne démarre qu'au clic sur « Installer » : c'est l'accord de l'utilisateur.
 */
export function NeuralVoiceSection({ bridge, t }: NeuralVoiceSectionProps) {
  const [installed, setInstalled] = useState<Record<string, boolean | undefined>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = () => {
    for (const { locale } of LANGUAGES) {
      bridge.speechNeuralAvailable(locale).then(
        (value) => setInstalled((current) => ({ ...current, [locale]: value })),
        () => setInstalled((current) => ({ ...current, [locale]: false })),
      );
    }
  };

  useEffect(refresh, [bridge]);

  const install = async (locale: string) => {
    setBusy(locale);
    setFailed(false);
    try {
      await bridge.speechNeuralInstall(locale);
      refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="natural-voice">
      <h3>{t("voice.natural.title")}</h3>
      <p className="muted small">{t("voice.natural.hint")}</p>
      {LANGUAGES.map(({ locale, label }) => (
        <div className="natural-voice-row" key={locale}>
          <span>{label}</span>
          {installed[locale] === undefined && <small className="muted">…</small>}
          {installed[locale] === true && <small className="ok">{t("voice.natural.installed")}</small>}
          {installed[locale] === false && (
            <button type="button" onClick={() => void install(locale)} disabled={busy !== null}>
              {busy === locale ? t("voice.natural.installing") : t("voice.natural.install")}
            </button>
          )}
        </div>
      ))}
      {failed && (
        <p className="warn small" role="alert">
          {t("voice.natural.failed")}
        </p>
      )}
    </div>
  );
}
