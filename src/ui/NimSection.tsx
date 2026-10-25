import { useEffect, useState } from "react";

import type { NativeBridge } from "../core/native/bridge";
import type { MessageKey } from "../i18n/messages";
import { readNimSettings, writeNimSettings } from "./nimSettings";

interface NimSectionProps {
  bridge: NativeBridge;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/**
 * Réglage NVIDIA NIM : désactivé par défaut. Activer envoie les demandes à NVIDIA ; Ollama reste le repli. La clé saisie
 * part directement dans le stockage natif chiffré : elle n'est gardée ni dans le navigateur ni relue par l'interface.
 */
export function NimSection({ bridge, t }: NimSectionProps) {
  const [settings, setSettings] = useState(readNimSettings);
  const [keyInput, setKeyInput] = useState("");
  const [keySaved, setKeySaved] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    bridge
      .nimKeyStatus()
      .then((present) => {
        if (current) setKeySaved(present);
      })
      .catch(() => {
        if (current) setKeySaved(false);
      });
    return () => {
      current = false;
    };
  }, [bridge]);

  const save = async () => {
    writeNimSettings(settings);
    try {
      if (keyInput.trim()) {
        await bridge.nimKeySave(keyInput.trim());
        setKeySaved(true);
        setKeyInput("");
      }
      setError(null);
      setSaved(true);
    } catch (failure) {
      setSaved(false);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const clearKey = async () => {
    try {
      await bridge.nimKeyClear();
      setKeySaved(false);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

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
          value={keyInput}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setKeyInput(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <p className="field-hint" role="status">
        {keySaved === null ? "" : keySaved ? t("nim.keySaved") : t("nim.keyMissing")}
      </p>
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
      <button type="button" className="chip" onClick={() => void save()}>
        {t("nim.save")}
      </button>
      {keySaved && (
        <button type="button" className="chip" onClick={() => void clearKey()}>
          {t("nim.keyClear")}
        </button>
      )}
      {saved && (
        <p className="field-hint" role="status">
          {t("nim.saved")}
        </p>
      )}
      {error && (
        <p className="field-hint" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
