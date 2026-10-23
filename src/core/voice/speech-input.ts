import { listen } from "@tauri-apps/api/event";

import { isDesktopRuntime, NativeUnavailableError } from "../native";
import { callNative } from "../native/tauri-adapter";
import type { SpeechInput, VoiceEvent, VoiceLanguage } from "./types";

export const VOICE_EVENT_CHANNEL = "voice://event";
export const VOICE_TOGGLE_CHANNEL = "voice://toggle";

/** Pont vers le backend natif : micro, VAD, whisper.cpp et raccourci global. */
export class TauriSpeechInput implements SpeechInput {
  start(language: VoiceLanguage | undefined): Promise<void> {
    return callNative<void>("voice_start", { language: language ?? null });
  }

  stop(): Promise<void> {
    return callNative<void>("voice_stop");
  }

  onEvent(listener: (event: VoiceEvent) => void): () => void {
    const unlisten = listen<VoiceEvent>(VOICE_EVENT_CHANNEL, (event) => listener(event.payload));
    return () => void unlisten.then((stop) => stop());
  }

  onToggleRequest(listener: () => void): () => void {
    const unlisten = listen(VOICE_TOGGLE_CHANNEL, () => listener());
    return () => void unlisten.then((stop) => stop());
  }
}

/** Hors application de bureau, le micro n'existe pas : chaque demande échoue explicitement. */
export class UnavailableSpeechInput implements SpeechInput {
  start(): Promise<void> {
    return Promise.reject(new NativeUnavailableError());
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  onEvent(): () => void {
    return () => {};
  }

  onToggleRequest(): () => void {
    return () => {};
  }
}

export function createSpeechInput(): SpeechInput {
  return isDesktopRuntime() ? new TauriSpeechInput() : new UnavailableSpeechInput();
}

export interface VoiceModelStatus {
  modelPath: string;
  modelPresent: boolean;
  listening: boolean;
}

/** État du modèle de reconnaissance (emplacement attendu, présence). `null` hors application de bureau. */
export function readVoiceModelStatus(): Promise<VoiceModelStatus | null> {
  if (!isDesktopRuntime()) return Promise.resolve(null);
  return callNative<VoiceModelStatus>("voice_status");
}
