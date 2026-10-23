import { useState, type FormEvent } from "react";

import type { VoiceStatus } from "../core/voice/types";

interface VoiceControl {
  status: VoiceStatus;
  onToggle: () => void;
  startLabel: string;
  stopLabel: string;
}

interface CommandBarProps {
  placeholder: string;
  sendLabel: string;
  onSubmit: (text: string) => void;
  voice?: VoiceControl;
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
        <button
          type="button"
          className={`mic${listening ? " active" : ""}`}
          onClick={voice.onToggle}
          aria-pressed={listening}
          aria-label={listening ? voice.stopLabel : voice.startLabel}
        >
          <MicIcon />
        </button>
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
