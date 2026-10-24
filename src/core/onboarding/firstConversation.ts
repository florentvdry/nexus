import type { MessageKey } from "../../i18n/messages";
import type { MemoryBridge } from "../memory/memory";

/**
 * Première conversation, juste après l'installation du modèle : NEXUS pose quelques questions pour connaître
 * l'utilisateur (prénom, lieu, activité, ton, longueur des réponses…). Chaque réponse est gardée telle quelle comme
 * souvenir, « Libellé : réponse », et sert ensuite au modèle pour répondre comme l'utilisateur préfère.
 * Une question peut être passée ; rien n'est alors gardé pour elle.
 */

interface Question {
  label: MessageKey;
  ask: MessageKey;
}

/** Questions dans l'ordre. Le nom d'abord, puis le contexte utile, puis la manière de répondre. */
export const QUESTIONS: readonly Question[] = [
  { label: "onboarding.label.name", ask: "onboarding.q.name" },
  { label: "onboarding.label.place", ask: "onboarding.q.place" },
  { label: "onboarding.label.job", ask: "onboarding.q.job" },
  { label: "onboarding.label.use", ask: "onboarding.q.use" },
  { label: "onboarding.label.tone", ask: "onboarding.q.tone" },
  { label: "onboarding.label.length", ask: "onboarding.q.length" },
  { label: "onboarding.label.never", ask: "onboarding.q.never" },
];

const SKIP = /^(?:passer|passe|skip|plus tard)$/i;

export interface FirstConversationOptions {
  bridge: MemoryBridge;
  say: (text: string, tone?: "info" | "error") => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

export class FirstConversation {
  readonly #options: FirstConversationOptions;
  #index = -1;

  constructor(options: FirstConversationOptions) {
    this.#options = options;
  }

  /** Vrai tant que des questions restent sans réponse. La saisie de l'utilisateur va alors aux questions. */
  get active(): boolean {
    return this.#index >= 0 && this.#index < QUESTIONS.length;
  }

  /** Commence la conversation : présentation, puis la première question. */
  start(): void {
    this.#index = 0;
    this.#options.say(this.#options.t("onboarding.intro"));
    this.#ask();
  }

  /** Traite une réponse. Renvoie `false` quand la conversation n'est pas en cours : la saisie est alors une demande normale. */
  async consume(text: string): Promise<boolean> {
    if (!this.active) return false;
    const answer = text.trim();
    const question = QUESTIONS[this.#index];
    this.#index += 1;
    if (!SKIP.test(answer)) await this.#remember(question, answer);

    if (this.active) {
      this.#ask();
    } else {
      this.#options.say(this.#options.t("onboarding.done"));
    }
    return true;
  }

  #ask(): void {
    this.#options.say(this.#options.t(QUESTIONS[this.#index].ask));
  }

  async #remember(question: Question, answer: string): Promise<void> {
    if (answer.length === 0) return;
    try {
      await this.#options.bridge.memoryAdd(`${this.#options.t(question.label)} : ${answer}`, "user");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#options.say(this.#options.t("memory.failed", { message }), "error");
    }
  }
}
