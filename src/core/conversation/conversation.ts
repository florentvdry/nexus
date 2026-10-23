import { normalize } from "../intent/normalize";
import { type Clarification, type ClarificationOption, type Referent } from "./types";

/** Mots d'ordre : « le premier », « la deuxième », « le dernier ». Seuls les déterminants déclenchent la référence. */
const ORDINALS: { words: string[]; index: number }[] = [
  { words: ["premier", "premiere", "first", "1er", "1ere"], index: 0 },
  { words: ["deuxieme", "second", "seconde", "2eme", "2e"], index: 1 },
  { words: ["troisieme", "third", "3eme", "3e"], index: 2 },
  { words: ["quatrieme", "fourth", "4eme", "4e"], index: 3 },
  { words: ["dernier", "derniere", "last"], index: -1 },
];

// Formes accentuées et non accentuées : la saisie peut venir de la dictée comme du clavier.
const ORDINAL_PHRASE = /\b(?:le|la|les|l'|the)\s+(premi[eè]re?|1er|1[eè]re|first|deuxi[eè]me|second|seconde|2[eè]me|2e|troisi[eè]me|third|3[eè]me|3e|quatri[eè]me|fourth|4[eè]me|4e|derni[eè]re?|last)\b/i;
/**
 * Verbe d'action sur un élément, suivi d'un pronom qui le désigne : « ferme-le », « renomme ça », « renomme le en X ».
 * Un « le » ou « la » sans trait d'union n'est une référence que s'il est suivi de « en » ou se trouve en fin de phrase :
 * « ouvre la calculatrice » reste une demande d'application.
 */
const PRONOUN_PHRASE = /\b(ferme|fermer|ouvre|ouvrir|renomme|renommer|supprime|supprimer|efface|effacer|analyse|analyser|d[ée]place|d[ée]placer|active|affiche)(?:-le|-la|-ca|-ça|-cela|-celui-ci|-celle-ci|\s+(?:ça|ca|cela|celui-ci|celle-ci)\b|\s+(?:le|la)(?=\s+en\b|\s*$))/i;

/** Ce qui remplace une référence dans la commande réécrite. Un fichier devient « le fichier "<chemin>" ». */
function noun(referent: Referent): string {
  return referent.kind === "file" ? `le fichier "${referent.value}"` : `la fenêtre ${referent.value}`;
}

function ordinalIndex(word: string): number | undefined {
  const normalized = normalize(word);
  return ORDINALS.find((ordinal) => ordinal.words.includes(normalized))?.index;
}

export interface Resolution {
  text: string;
  /** Présent quand la référence est ambiguë : l'utilisateur doit choisir. */
  clarification?: Clarification;
}

/**
 * Mémoire de la conversation : les éléments de la dernière liste affichée, et la question en attente. Les
 * références (« le deuxième », « ferme-le ») sont réécrites en commandes explicites avant la compréhension : la
 * logique de sécurité reste celle des commandes normales.
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

  /** Réécrit « le deuxième », « ferme-le » en commandes explicites, ou demande lequel quand c'est ambigu. */
  resolve(text: string): Resolution {
    if (this.#referents.length === 0) return { text };

    const ordinal = text.match(ORDINAL_PHRASE);
    if (ordinal) {
      const index = ordinalIndex(ordinal[1]);
      const position = index === -1 ? this.#referents.length - 1 : index ?? -1;
      const referent = this.#referents[position];
      if (!referent) return { text };
      return { text: text.replace(ORDINAL_PHRASE, noun(referent)) };
    }

    const pronoun = text.match(PRONOUN_PHRASE);
    if (pronoun) {
      const rewrite = (referent: Referent) => text.replace(PRONOUN_PHRASE, (_match, verb: string) => `${verb} ${noun(referent)}`);
      if (this.#referents.length === 1) return { text: rewrite(this.#referents[0]) };
      return {
        text,
        clarification: {
          question: "Lequel ?",
          options: this.#referents.slice(0, 8).map((referent) => ({ label: referent.label, text: rewrite(referent) })),
        },
      };
    }
    return { text };
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
