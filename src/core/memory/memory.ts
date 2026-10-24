import type { MessageKey } from "../../i18n/messages";
import type { Memory } from "./types";

/**
 * Souvenirs de l'utilisateur. Le modèle décide ce qui compte et les enregistre sans question (`REMEMBER`) ; l'oubli
 * d'un souvenir se fait tout de suite ; tout effacer demande une confirmation. Les souvenirs ne quittent jamais le
 * poste : le modèle local les reçoit seulement au moment d'une demande.
 */

export interface MemoryBridge {
  memoryList(): Promise<Memory[]>;
  memoryAdd(text: string, source: "user" | "model"): Promise<Memory>;
  memoryForget(query: string): Promise<number>;
  memoryClear(): Promise<number>;
}

export interface MemoryControllerOptions {
  bridge: MemoryBridge;
  say: (text: string, tone?: "info" | "error") => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const YES = /^(?:oui|yes|ok|d accord|vas y|efface|1)$/i;
const NO = /^(?:non|no|annule|annuler|laisse tomber|stop|cancel|2)$/i;

export class MemoryController {
  readonly #options: MemoryControllerOptions;
  /** Vrai quand « tout effacer » attend la confirmation de l'utilisateur. */
  #awaitingClear = false;

  constructor(options: MemoryControllerOptions) {
    this.#options = options;
  }

  /** Enregistre une information que le modèle juge utile sur l'utilisateur. */
  async remember(text: string): Promise<void> {
    await this.#store(text, "model");
  }

  /** Oublie les souvenirs qui contiennent `query`, ou tout (avec confirmation) quand `query` est `null`. */
  async forget(query: string | null): Promise<void> {
    try {
      if (query === null) {
        const count = (await this.#options.bridge.memoryList()).length;
        if (count === 0) return this.#options.say(this.#options.t("memory.none"));
        this.#awaitingClear = true;
        return this.#options.say(this.#options.t("memory.clearAsk", { count }));
      }
      const removed = await this.#options.bridge.memoryForget(query);
      if (removed === 0) return this.#options.say(this.#options.t("memory.notFound", { query }));
      this.#options.say(this.#options.t("memory.forgotten", { count: removed }));
    } catch (error) {
      this.#failed(error);
    }
  }

  async list(): Promise<void> {
    try {
      const memories = await this.#options.bridge.memoryList();
      if (memories.length === 0) return this.#options.say(this.#options.t("memory.none"));
      const list = memories.map((memory, index) => `${index + 1}) ${memory.text}`).join(" · ");
      this.#options.say(this.#options.t("memory.list", { list }));
    } catch (error) {
      this.#failed(error);
    }
  }

  /** Textes des souvenirs, pour donner du contexte au modèle. Une panne ne bloque jamais une demande. */
  async texts(): Promise<string[]> {
    try {
      return (await this.#options.bridge.memoryList()).map((memory) => memory.text);
    } catch {
      return [];
    }
  }

  get awaitsAnswer(): boolean {
    return this.#awaitingClear;
  }

  /**
   * Traite « oui » ou « non » quand « tout effacer » attend une réponse. Renvoie `false` si la saisie n'y répond
   * pas : elle est alors traitée comme une nouvelle demande et la question est abandonnée.
   */
  async consume(text: string): Promise<boolean> {
    if (!this.#awaitingClear) return false;
    const trimmed = text.trim();
    this.#awaitingClear = false;
    if (NO.test(trimmed)) {
      this.#options.say(this.#options.t("memory.cancelled"));
      return true;
    }
    if (!YES.test(trimmed)) return false;
    try {
      const count = await this.#options.bridge.memoryClear();
      this.#options.say(this.#options.t("memory.cleared", { count }));
    } catch (error) {
      this.#failed(error);
    }
    return true;
  }

  async #store(text: string, source: "user" | "model"): Promise<void> {
    try {
      const memory = await this.#options.bridge.memoryAdd(text, source);
      this.#options.say(this.#options.t("memory.saved", { text: memory.text }));
    } catch (error) {
      this.#failed(error);
    }
  }

  #failed(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.#options.say(this.#options.t("memory.failed", { message }), "error");
  }
}
