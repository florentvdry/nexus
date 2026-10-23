import { useEffect, useState, type ReactNode } from "react";

import { listSystemVoices, type SpeechVoice } from "../../plugins/speech/system-tts";
import { readVoiceModelStatus, type VoiceModelStatus } from "../../plugins/speech/whisper-stt";
import type { ReplyMode, VoiceSettings, VoiceLanguageSetting } from "../core/voice/settings";
import type { MessageKey } from "../i18n/messages";

interface VoicePanelProps {
  settings: VoiceSettings;
  onChange: (patch: Partial<VoiceSettings>) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  onClose: () => void;
  /** Sections supplémentaires des réglages, rendues sous les options vocales. */
  children?: ReactNode;
}

export function VoicePanel({ settings, onChange, t, onClose, children }: VoicePanelProps) {
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [model, setModel] = useState<VoiceModelStatus | null | undefined>(undefined);

  useEffect(() => {
    setVoices(listSystemVoices());
    readVoiceModelStatus().then(setModel, () => setModel(null));
  }, []);

  return (
    <section className="voice-panel" data-hud aria-label={t("voice.settingsTitle")}>
      <header>
        <h2>{t("voice.settingsTitle")}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("ui.close")}>
          ×
        </button>
      </header>

      <label className="field toggle">
        <input type="checkbox" checked={settings.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
        {t("voice.enabled")}
      </label>

      <label className="field">
        <span>{t("voice.language")}</span>
        <select
          value={settings.language}
          onChange={(event) => onChange({ language: event.target.value as VoiceLanguageSetting })}
        >
          <option value="auto">{t("voice.language.auto")}</option>
          <option value="fr">Français</option>
          <option value="en">English</option>
        </select>
      </label>

      <label className="field">
        <span>{t("voice.spokenReplies")}</span>
        <select value={settings.replyMode} onChange={(event) => onChange({ replyMode: event.target.value as ReplyMode })}>
          <option value="off">{t("voice.replies.off")}</option>
          <option value="voice">{t("voice.replies.voice")}</option>
          <option value="always">{t("voice.replies.always")}</option>
        </select>
      </label>

      <label className="field">
        <span>{t("voice.volume")}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.volume}
          onChange={(event) => onChange({ volume: Number(event.target.value) })}
        />
      </label>

      <label className="field">
        <span>{t("voice.rate")}</span>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.05}
          value={settings.rate}
          onChange={(event) => onChange({ rate: Number(event.target.value) })}
        />
      </label>

      <label className="field">
        <span>{t("voice.voice")}</span>
        <select value={settings.voiceName ?? ""} onChange={(event) => onChange({ voiceName: event.target.value || null })}>
          <option value="">{t("voice.voiceDefault")}</option>
          {voices.map((voice) => (
            <option key={voice.name} value={voice.name}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
      </label>
      {voices.length === 0 && <p className="muted small">{t("voice.noSpeechOutput")}</p>}

      <div className="model">
        <span>{t("voice.model")}</span>
        {model === undefined && <small className="muted">…</small>}
        {model === null && <small className="muted">—</small>}
        {model && (
          <>
            <small className={model.modelPresent ? "ok" : "warn"}>
              {model.modelPresent ? t("voice.modelPresent") : t("voice.modelMissing")}
            </small>
            <code>{model.modelPath}</code>
          </>
        )}
      </div>

      <p className="muted small">{t("voice.shortcut")}</p>
      {children}
    </section>
  );
}
