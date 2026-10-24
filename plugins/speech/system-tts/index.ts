import type { PluginApi } from "../../../src/core/plugins/types";
import type { SpeakOptions, SpeechOutput } from "../../../src/core/voice/types";
import { spokenSentences } from "../../../src/core/voice/spoken";

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

/** Les voix « naturelles » de Windows (neurales) sonnent nettement mieux que les voix SAPI classiques. */
const NATURAL_VOICE = /natural|neural|online/i;

/** Points d'une voix pour une langue : la langue exacte d'abord, puis une voix naturelle. Zéro : voix d'une autre langue. */
export function voiceScore(voice: Pick<SpeechSynthesisVoice, "name" | "lang">, lang: string): number {
  const wanted = lang.toLowerCase();
  const actual = voice.lang.toLowerCase().replace("_", "-");
  if (actual !== wanted && !actual.startsWith(wanted.slice(0, 2))) return 0;
  return (actual === wanted ? 4 : 2) + (NATURAL_VOICE.test(voice.name) ? 6 : 0);
}

/** La voix demandée par son nom, sinon la mieux placée pour la langue. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string, voiceName: string | null): SpeechSynthesisVoice | undefined {
  const requested = voiceName ? voices.find((voice) => voice.name === voiceName) : undefined;
  if (requested) return requested;
  let best: SpeechSynthesisVoice | undefined;
  let bestScore = 0;
  for (const voice of voices) {
    const score = voiceScore(voice, lang);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

export class WebSpeechOutput implements SpeechOutput {
  get available(): boolean {
    return hasSpeechSynthesis();
  }

  /**
   * Lit la réponse phrase par phrase : le texte écrit pour l'écran (adresses, puces, sources) est nettoyé, et chaque
   * phrase est une élocution séparée, ce qui garde une intonation plus naturelle.
   */
  speak(text: string, options: SpeakOptions): void {
    if (!this.available) return;
    const lang = options.locale === "fr" ? "fr-FR" : "en-US";
    const voice = pickVoice(window.speechSynthesis.getVoices(), lang, options.voiceName);
    for (const sentence of spokenSentences(text)) {
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.lang = lang;
      utterance.rate = options.rate;
      utterance.volume = options.volume;
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    }
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
