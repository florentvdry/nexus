import type { PluginApi } from "../../../src/core/plugins/types";
import type { SpeakOptions, SpeechOutput } from "../../../src/core/voice/types";

function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export interface SpeechVoice {
  name: string;
  lang: string;
}

/** Voix installées sur le système (WebView2 sur Windows expose les voix SAPI, hors ligne). */
export function listSystemVoices(): SpeechVoice[] {
  if (!hasSpeechSynthesis()) return [];
  return window.speechSynthesis.getVoices().map((voice) => ({ name: voice.name, lang: voice.lang }));
}

export function pickVoice(voices: SpeechSynthesisVoice[], lang: string, voiceName: string | null): SpeechSynthesisVoice | undefined {
  return (voiceName && voices.find((voice) => voice.name === voiceName)) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2)));
}

export class WebSpeechOutput implements SpeechOutput {
  get available(): boolean {
    return hasSpeechSynthesis();
  }

  speak(text: string, options: SpeakOptions): void {
    if (!this.available) return;
    const lang = options.locale === "fr" ? "fr-FR" : "en-US";
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = options.rate;
    utterance.volume = options.volume;
    const voice = pickVoice(window.speechSynthesis.getVoices(), lang, options.voiceName);
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }

  cancel(): void {
    if (this.available) window.speechSynthesis.cancel();
  }
}

/** Sortie absente : la réponse reste affichée à l'écran. */
export const silentSpeechOutput: SpeechOutput = {
  available: false,
  speak: () => {},
  cancel: () => {},
};

export function activate(_api: PluginApi): void {}
