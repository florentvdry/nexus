import type { MessageKey } from "../../i18n/messages";
import type { MemoryBridge } from "../memory/memory";

/**
 * Première conversation, juste après l'installation du modèle : NEXUS pose quelques questions pour connaître
 * l'utilisateur. Chaque réponse est vérifiée : une salutation ou une réponse hors sujet n'est pas gardée, et la
 * question est reposée avec une indication. Une réponse valide devient un souvenir « Libellé : réponse ».
 * Une question peut être passée ; rien n'est alors gardé pour elle.
 */

type Check = "name" | "place" | "text" | "tone" | "length";

interface Question {
  label: MessageKey;
  ask: MessageKey;
  hint: MessageKey;
  check: Check;
}

/** Questions dans l'ordre. Le nom d'abord, puis le contexte utile, puis la manière de répondre. */
export const QUESTIONS: readonly Question[] = [
  { label: "onboarding.label.name", ask: "onboarding.q.name", hint: "onboarding.hint.name", check: "name" },
  { label: "onboarding.label.place", ask: "onboarding.q.place", hint: "onboarding.hint.place", check: "place" },
  { label: "onboarding.label.job", ask: "onboarding.q.job", hint: "onboarding.hint.text", check: "text" },
  { label: "onboarding.label.use", ask: "onboarding.q.use", hint: "onboarding.hint.text", check: "text" },
  { label: "onboarding.label.tone", ask: "onboarding.q.tone", hint: "onboarding.hint.tone", check: "tone" },
  { label: "onboarding.label.length", ask: "onboarding.q.length", hint: "onboarding.hint.length", check: "length" },
  { label: "onboarding.label.never", ask: "onboarding.q.never", hint: "onboarding.hint.text", check: "text" },
];

const SKIP = /^(?:passer|passe|skip|plus tard)$/i;
/** Salutations et réponses de politesse : jamais une réponse à une question de profil. */
const NOT_AN_ANSWER = /^(?:salut|slt|bonjour|bonsoir|bjr|coucou|hello|hi|hey|yo|ok|oui|non|yes|no|merci|d'accord)\b[\s!.?]*$/i;

/** La réponse est-elle utilisable pour cette question ? */
export function acceptable(check: Check, answer: string): boolean {
  const text = answer.trim();
  if (NOT_AN_ANSWER.test(text)) return false;
  switch (check) {
    case "name":
      return /^[\p{L}][\p{L} '’-]{1,39}$/u.test(text);
    case "place":
      return text.length >= 2;
    case "text":
      return text.length >= 3;
    case "tone":
      return /tu|vous|tutoi|vouvoi|informel|formel|familier/i.test(text);
    case "length":
      return /court|brev|bref|concis|détaill|detaill|long|complet|précis|precis/i.test(text);
  }
}

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
    if (SKIP.test(answer)) {
      this.#advance();
      return true;
    }
    if (!acceptable(question.check, answer)) {
      // Pas de souvenir pour une réponse inutilisable : on repose la même question, avec une indication.
      this.#options.say(this.#options.t("onboarding.retry"));
      this.#options.say(this.#options.t("onboarding.hintLine", { hint: this.#options.t(question.hint) }));
      this.#options.say(this.#options.t(question.ask));
      return true;
    }
    await this.#remember(question, answer);
    this.#advance();
    return true;
  }

  #advance(): void {
    this.#index += 1;
    if (this.active) {
      this.#ask();
    } else {
      this.#options.say(this.#options.t("onboarding.done"));
      // Une seule astuce, après la première conversation : des exemples de ce que NEXUS sait faire de plus.
      this.#options.say(this.#options.t("onboarding.tip"));
    }
  }

  #ask(): void {
    this.#options.say(this.#options.t(QUESTIONS[this.#index].ask));
  }

  async #remember(question: Question, answer: string): Promise<void> {
    try {
      await this.#options.bridge.memoryAdd(`${this.#options.t(question.label)} : ${answer}`, "user");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#options.say(this.#options.t("memory.failed", { message }), "error");
    }
  }
}
