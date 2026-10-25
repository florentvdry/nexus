import { useState, type FormEvent } from "react";

import type { VoiceStatus } from "../core/voice/types";
import { MicIcon, SendIcon, SpeakerIcon } from "./icons";

export interface VoiceControl {
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

/** Barre de commande flottante : micro, saisie, lecture vocale et envoi, dans une seule pilule. */
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
          className={`command-voice${listening ? " active" : ""}`}
          onClick={voice.onToggle}
          aria-pressed={listening}
          aria-label={listening ? voice.stopLabel : voice.startLabel}
        >
          <MicIcon size={20} />
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
      {voice && (
        <button
          type="button"
          className={`command-voice quiet${voice.speaking ? " active" : ""}`}
          onClick={voice.onToggleSpeaking}
          aria-pressed={voice.speaking}
          aria-label={voice.speakingLabel}
        >
          <SpeakerIcon size={20} muted={!voice.speaking} />
        </button>
      )}
      <button type="submit" className="command-send" aria-label={sendLabel}>
        <SendIcon size={20} />
      </button>
    </form>
  );
}
