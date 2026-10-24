/**
 * Types des dictionnaires de commandes. Les données (verbes, expressions) sont fournies par les plugins `languages` :
 * voir `src/core/intent/registry.ts`. Les formes sont normalisées (sans accents).
 */

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

export function matchesAny(patterns: RegExp[], text: string): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}
