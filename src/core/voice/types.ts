import type { Locale } from "../../i18n/messages";

/** Langues reconnues et prononcées. Ajouter une langue = ajouter son code ici et ses dictionnaires. */
export type VoiceLanguage = "fr" | "en";

/** Événements émis par le backend vocal (`voice://event`). */
export type VoiceEvent =
  | { kind: "listening" }
  | { kind: "speech-started" }
  | { kind: "transcribing" }
  | { kind: "transcript"; text: string; language: string | null }
  | { kind: "error"; code: string; message: string }
  | { kind: "stopped" };

export interface SpeechInput {
  start(language: VoiceLanguage | undefined): Promise<void>;
  stop(): Promise<void>;
  onEvent(listener: (event: VoiceEvent) => void): () => void;
  /** Demande de basculement, par exemple depuis le raccourci clavier global. */
  onToggleRequest(listener: () => void): () => void;
}

export interface SpeakOptions {
  locale: Locale;
  rate: number;
  volume: number;
  voiceName: string | null;
}

export interface SpeechOutput {
  readonly available: boolean;
  speak(text: string, options: SpeakOptions): void;
  cancel(): void;
}

export type VoiceStatus = "off" | "listening" | "recognizing";
