import type { MessageKey } from "../../i18n/messages";
import { normalize } from "./normalize";

/**
 * Types des dictionnaires de commandes. Les données (verbes, expressions, alias) sont fournies par les plugins
 * `languages` et `actions` : voir `src/core/intent/registry.ts`. Les formes sont normalisées (sans accents).
 */

export type AppId = string;

export interface AppEntry {
  id: AppId;
  /** Clé de traduction du nom affiché (`app.*`). */
  nameKey: MessageKey;
  aliases: string[];
}

export interface LanguageDictionary {
  openVerbs: RegExp[];
  closeAll: RegExp[];
  closeWindow: RegExp[];
  cancelTasks: RegExp[];
  systemInfo: RegExp[];
  help: RegExp[];
  /** Mots retirés du nom d'application extrait (« lance LE bloc-notes »). */
  fillerWords: RegExp;
}

export interface ApplicationMatch {
  entry: AppEntry;
  alias: string;
}

/** Renvoie l'application dont l'alias le plus long apparaît en entier dans le texte. */
export function findApplication(normalizedText: string, apps: readonly AppEntry[]): ApplicationMatch | undefined {
  let best: ApplicationMatch | undefined;
  for (const entry of apps) {
    for (const alias of entry.aliases.map(normalize)) {
      const pattern = new RegExp(`(^|\\s)${escapeRegExp(alias)}(?=\\s|$)`);
      if (pattern.test(normalizedText) && (!best || alias.length > best.alias.length)) {
        best = { entry, alias };
      }
    }
  }
  return best;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesAny(patterns: RegExp[], text: string): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}
