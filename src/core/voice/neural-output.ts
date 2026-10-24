import { spokenSentences } from "./spoken";
import type { SpeakOptions, SpeechOutput } from "./types";

/**
 * Voix naturelle : le natif synthétise la réponse en WAV (Piper, en local), et l'interface la joue avec l'audio du
 * navigateur. Sans voix installée, ou si la synthèse échoue, la voix Windows prend le relais : la réponse est toujours lue.
 */

/** Ce qu'il faut à la sortie pour parler : la présence de la voix, et la synthèse d'un texte en WAV (base64). */
export interface NeuralVoiceSource {
  installed(): Promise<boolean>;
  synthesize(text: string, rate: number): Promise<string>;
}

/** Sous-ensemble de l'AudioContext utilisé ici, pour pouvoir le remplacer dans les tests. */
export interface PlaybackContext {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  createBufferSource(): AudioBufferSourceNode;
  createGain(): GainNode;
  readonly destination: AudioDestinationNode;
  readonly currentTime: number;
  resume?(): Promise<void>;
}

/** Voix française naturelle. L'anglais reste sur la voix Windows : la voix installée ne parle que le français. */
const NEURAL_LOCALE = "fr";

function base64Bytes(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export class NeuralSpeechOutput implements SpeechOutput {
  readonly #source: NeuralVoiceSource;
  readonly #fallback: SpeechOutput;
  readonly #createContext: () => PlaybackContext;
  #context: PlaybackContext | undefined;
  #playing = new Set<AudioBufferSourceNode>();
  /** Incrémenté à chaque annulation : une synthèse en cours qui arrive après est ignorée. */
  #generation = 0;

  constructor(source: NeuralVoiceSource, fallback: SpeechOutput, createContext: () => PlaybackContext) {
    this.#source = source;
    this.#fallback = fallback;
    this.#createContext = createContext;
  }

  get available(): boolean {
    return this.#fallback.available;
  }

  speak(text: string, options: SpeakOptions): void {
    if (options.locale !== NEURAL_LOCALE) return this.#fallback.speak(text, options);
    const sentences = spokenSentences(text);
    if (sentences.length === 0) return;
    const generation = this.#generation;
    void this.#speakNeural(sentences.join("\n"), options, generation, text);
  }

  async #speakNeural(text: string, options: SpeakOptions, generation: number, original: string): Promise<void> {
    try {
      if (!(await this.#source.installed())) return this.#fallback.speak(original, options);
      const wav = await this.#source.synthesize(text, options.rate);
      if (generation !== this.#generation) return;
      const context = this.#playbackContext();
      await context.resume?.();
      const buffer = await context.decodeAudioData(base64Bytes(wav));
      if (generation !== this.#generation) return;
      this.#play(context, buffer, options.volume);
    } catch {
      if (generation === this.#generation) this.#fallback.speak(original, options);
    }
  }

  #playbackContext(): PlaybackContext {
    this.#context ??= this.#createContext();
    return this.#context;
  }

  #play(context: PlaybackContext, buffer: AudioBuffer, volume: number): void {
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => this.#playing.delete(source);
    this.#playing.add(source);
    source.start(context.currentTime);
  }

  cancel(): void {
    this.#generation += 1;
    for (const source of this.#playing) {
      try {
        source.stop();
      } catch {
        // Déjà arrêtée : rien à faire.
      }
    }
    this.#playing.clear();
    this.#fallback.cancel();
  }
}
