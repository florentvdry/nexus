import { useState, type FormEvent } from "react";

import type { VoiceStatus } from "../core/voice/types";

interface VoiceControl {
  status: VoiceStatus;
  onToggle: () => void;
  startLabel: string;
  stopLabel: string;
  /** Réponses lues à voix haute : mode actif hors « jamais ». */
  speaking: boolean;
  onToggleSpeaking: () => void;
  speakingLabel: string;
}

interface CommandBarProps {
  placeholder: string;
  sendLabel: string;
  onSubmit: (text: string) => void;
  voice?: VoiceControl;
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor" />
      {muted ? (
        <path d="M16 9l5 6m0-6l-5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CommandBar({ placeholder, sendLabel, onSubmit, voice }: CommandBarProps) {
  const [value, setValue] = useState("");
  const listening = voice !== undefined && voice.status !== "off";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue("");
  };

  return (
    <form className="command" data-hud onSubmit={submit}>
      {voice && (
        <>
          <button
            type="button"
            className={`mic${listening ? " active" : ""}`}
            onClick={voice.onToggle}
            aria-pressed={listening}
            aria-label={listening ? voice.stopLabel : voice.startLabel}
          >
            <MicIcon />
          </button>
          <button
            type="button"
            className={`mic${voice.speaking ? " active" : ""}`}
            onClick={voice.onToggleSpeaking}
            aria-pressed={voice.speaking}
            aria-label={voice.speakingLabel}
          >
            <SpeakerIcon muted={!voice.speaking} />
          </button>
        </>
      )}
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />
      <button type="submit" className="send">
        {sendLabel}
      </button>
    </form>
  );
}
