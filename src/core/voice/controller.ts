import { CapabilityError, toCapabilityError } from "../capabilities/errors";
import type { Engine, EngineEvent } from "../engine/engine";
import { translate, hasMessage, type Locale, type MessageKey } from "../../i18n/messages";
import { detectTextLanguage } from "./language";
import type { VoiceSettings } from "./settings";
import type { SpeechInput, SpeechOutput, VoiceEvent, VoiceLanguage, VoiceStatus } from "./types";

export interface VoiceControllerOptions {
  engine: Engine;
  input: SpeechInput;
  output: SpeechOutput;
  settings: () => VoiceSettings;
}

type StatusListener = (status: VoiceStatus) => void;

/**
 * Relie la voix au moteur de commandes :
 * - le micro (ou le raccourci) démarre et arrête l'écoute ;
 * - une transcription finale devient une commande, dans la langue détectée ;
 * - une réponse est lue à voix haute si l'option est active ;
 * - parler interrompt la lecture en cours (barge-in), comme toute nouvelle commande.
 */
export class VoiceController {
  readonly #engine: Engine;
  readonly #input: SpeechInput;
  readonly #output: SpeechOutput;
  readonly #settings: () => VoiceSettings;
  readonly #listeners = new Set<StatusListener>();
  readonly #unsubscribers: (() => void)[];
  #status: VoiceStatus = "off";
  /** Vrai si la dernière commande a été dite à l'oral : elle décide de la lecture à voix haute. */
  #lastCommandFromVoice = false;

  constructor(options: VoiceControllerOptions) {
    this.#engine = options.engine;
    this.#input = options.input;
    this.#output = options.output;
    this.#settings = options.settings;
    this.#unsubscribers = [
      this.#input.onEvent((event) => this.#handleVoiceEvent(event)),
      this.#input.onToggleRequest(() => void this.toggle()),
      this.#engine.subscribe((event) => this.#handleEngineEvent(event)),
    ];
  }

  get status(): VoiceStatus {
    return this.#status;
  }

  subscribe(listener: StatusListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    for (const unsubscribe of this.#unsubscribers) unsubscribe();
    this.#output.cancel();
  }

  async toggle(): Promise<void> {
    if (this.#status === "off") await this.start();
    else await this.stop();
  }

  async start(): Promise<void> {
    const settings = this.#settings();
    if (!settings.enabled) {
      this.#engine.say(this.#text("voice.disabled"), "error");
      return;
    }
    this.#output.cancel();
    try {
      await this.#input.start(settings.language === "auto" ? undefined : settings.language);
      this.#setStatus("listening");
    } catch (error) {
      this.#engine.say(this.#errorText(error), "error");
      this.#setStatus("off");
    }
  }

  async stop(): Promise<void> {
    try {
      await this.#input.stop();
    } finally {
      this.#setStatus("off");
    }
  }

  /** Saisie au clavier : la langue de réponse est déduite du texte. */
  submitText(text: string): void {
    this.#submit(text, detectTextLanguage(text), false);
  }

  #submit(text: string, detected: VoiceLanguage | undefined, fromVoice: boolean): void {
    this.#output.cancel();
    this.#lastCommandFromVoice = fromVoice;
    void this.#engine.submit(text, { locale: this.#replyLocale(detected) });
  }

  #replyLocale(detected: VoiceLanguage | undefined): Locale {
    const { language } = this.#settings();
    if (language !== "auto") return language;
    return detected ?? this.#engine.locale;
  }

  #handleVoiceEvent(event: VoiceEvent): void {
    switch (event.kind) {
      case "listening":
        this.#setStatus("listening");
        return;
      case "speech-started":
        this.#output.cancel();
        return;
      case "transcribing":
        this.#setStatus("recognizing");
        return;
      case "transcript":
        this.#setStatus("listening");
        this.#submit(event.text, event.language === "fr" || event.language === "en" ? event.language : undefined, true);
        return;
      case "error":
        this.#engine.say(this.#errorText(new CapabilityError(event.code, { details: event.message })), "error");
        return;
      case "stopped":
        this.#setStatus("off");
        return;
    }
  }

  #handleEngineEvent(event: EngineEvent): void {
    if (event.type !== "message") return;
    if (event.role === "user") {
      this.#output.cancel();
      return;
    }
    const settings = this.#settings();
    const speak = settings.replyMode === "always" || (settings.replyMode === "voice" && this.#lastCommandFromVoice);
    if (speak && this.#output.available) {
      this.#output.speak(event.text, {
        locale: event.locale,
        rate: settings.rate,
        volume: settings.volume,
        voiceName: settings.voiceName,
      });
    }
  }

  #setStatus(status: VoiceStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    for (const listener of this.#listeners) listener(status);
  }

  #text(key: MessageKey, params?: Record<string, string | number>): string {
    return translate(this.#engine.locale, key, params);
  }

  #errorText(error: unknown): string {
    const { code, params } = error instanceof CapabilityError ? error : toCapabilityError(error);
    const voiceKey = `voice.error.${code}`;
    if (hasMessage(voiceKey)) return this.#text(voiceKey, params);
    const genericKey = `error.code.${code}`;
    return this.#text(hasMessage(genericKey) ? genericKey : "error.code.plugin-failure", params);
  }
}
