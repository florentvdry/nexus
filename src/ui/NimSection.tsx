import { useState } from "react";

import type { MessageKey } from "../i18n/messages";
import { readNimSettings, writeNimSettings } from "./nimSettings";

interface NimSectionProps {
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/** Réglage NVIDIA NIM : désactivé par défaut. Activer envoie les demandes à NVIDIA ; Ollama reste le repli. */
export function NimSection({ t }: NimSectionProps) {
  const [settings, setSettings] = useState(readNimSettings);
  const [saved, setSaved] = useState(false);

  return (
    <section className="nim" aria-label={t("nim.title")}>
      <h3>{t("nim.title")}</h3>
      <p className="field-hint" role="note">{t("nim.warning")}</p>
      <label className="field toggle">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => {
            setSettings({ ...settings, enabled: event.target.checked });
            setSaved(false);
          }}
        />
        {t("nim.enable")}
      </label>
      <label className="field">
        <span>{t("nim.keyLabel")}</span>
        <input
          type="password"
          value={settings.key}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setSettings({ ...settings, key: event.target.value });
            setSaved(false);
          }}
        />
      </label>
      <label className="field">
        <span>{t("nim.modelLabel")}</span>
        <input
          type="text"
          value={settings.model}
          spellCheck={false}
          onChange={(event) => {
            setSettings({ ...settings, model: event.target.value });
            setSaved(false);
          }}
        />
      </label>
      <button
        type="button"
        className="chip"
        onClick={() => {
          writeNimSettings(settings);
          setSaved(true);
        }}
      >
        {t("nim.save")}
      </button>
      {saved && (
        <p className="field-hint" role="status">
          {t("nim.saved")}
        </p>
      )}
    </section>
  );
}
