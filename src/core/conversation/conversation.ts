import { normalize } from "../intent/normalize";
import { type Clarification, type ClarificationOption, type Referent } from "./types";

/** Mots d'ordre : « le premier », « la deuxième », « le dernier ». Utilisés pour répondre à une question à choix. */
const ORDINALS: { words: string[]; index: number }[] = [
  { words: ["premier", "premiere", "first", "1er", "1ere"], index: 0 },
  { words: ["deuxieme", "second", "seconde", "2eme", "2e"], index: 1 },
  { words: ["troisieme", "third", "3eme", "3e"], index: 2 },
  { words: ["quatrieme", "fourth", "4eme", "4e"], index: 3 },
  { words: ["dernier", "derniere", "last"], index: -1 },
];

function ordinalIndex(word: string): number | undefined {
  const normalized = normalize(word);
  return ORDINALS.find((ordinal) => ordinal.words.includes(normalized))?.index;
}

/**
 * Mémoire de la conversation : les éléments de la dernière liste affichée (le modèle les reçoit comme contexte pour
 * « ferme le deuxième »), et la question en attente. Aucune réécriture de texte : la compréhension est celle du modèle.
 */
export class Conversation {
  #referents: Referent[] = [];
  #pending: Clarification | null = null;

  /** Remplace les éléments de référence. Une liste vide efface la mémoire. */
  setReferents(referents: readonly Referent[]): void {
    this.#referents = [...referents];
  }

  referents(): readonly Referent[] {
    return this.#referents;
  }

  ask(clarification: Clarification): void {
    this.#pending = clarification;
  }

  pending(): Clarification | null {
    return this.#pending;
  }

  clearPending(): void {
    this.#pending = null;
  }
}

/**
 * Répond à une question en attente : un numéro, un ordinal, le libellé, « oui » pour une option unique, ou « non ».
 * Renvoie l'option choisie, `"cancel"`, ou `null` quand la saisie ne répond pas à la question.
 */
export function answerClarification(clarification: Clarification, text: string): ClarificationOption | "cancel" | null {
  const normalized = normalize(text);
  if (/^(?:non|no|annule|annuler|laisse|laisse tomber|stop|cancel)$/.test(normalized)) return "cancel";
  if (/^(?:oui|yes|ok|d accord|vas y|bien sur)$/.test(normalized)) {
    return clarification.options.length === 1 ? clarification.options[0] : null;
  }
  const number = normalized.match(/^(?:le |la |numero )?(\d+)$/);
  if (number) return clarification.options[Number(number[1]) - 1] ?? null;
  const ordinal = normalized.match(/^(?:le |la )?(premier|premiere|deuxieme|second|troisieme|quatrieme|dernier|derniere)$/);
  if (ordinal) {
    const index = ordinalIndex(ordinal[1]);
    const position = index === -1 ? clarification.options.length - 1 : index ?? -1;
    return clarification.options[position] ?? null;
  }
  if (normalized.length >= 3) {
    const matches = clarification.options.filter((option) => normalize(option.label).includes(normalized));
    if (matches.length === 1) return matches[0];
  }
  return null;
}
