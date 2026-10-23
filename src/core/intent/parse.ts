import { type AppId, LANGUAGE_DICTIONARIES, type LanguageDictionary, findApplication, matchesAny } from "./dictionaries";
import { normalize, stripWakeWord } from "./normalize";

export type Intent =
  | { type: "OPEN_APPLICATION"; appId?: AppId; appName: string }
  | { type: "SYSTEM_INFO" }
  | { type: "CLOSE_WINDOW" }
  | { type: "CLOSE_ALL_WINDOWS" }
  | { type: "CANCEL_TASKS" }
  | { type: "HELP" }
  | { type: "UNKNOWN"; text: string };

export interface ParseResult {
  intent: Intent;
  normalized: string;
  /** Toujours `rules` en phase 1 : aucune commande n'est envoyée à un modèle de langage. */
  resolvedBy: "rules";
}

function findOpenVerb(text: string, dictionary: LanguageDictionary): RegExpMatchArray | null {
  return matchesAny(dictionary.openVerbs, text);
}

/**
 * Classification déterministe (niveau 1 de l'architecture) : expressions régulières,
 * dictionnaires d'alias et ordre de priorité explicite. Ne fait jamais d'appel réseau.
 */
export function parseIntent(input: string): ParseResult {
  const normalized = stripWakeWord(normalize(input));
  return { intent: classify(normalized), normalized, resolvedBy: "rules" };
}

function classify(text: string): Intent {
  if (!text) return { type: "UNKNOWN", text: "" };

  for (const dictionary of LANGUAGE_DICTIONARIES) {
    if (matchesAny(dictionary.closeAll, text)) return { type: "CLOSE_ALL_WINDOWS" };
  }
  for (const dictionary of LANGUAGE_DICTIONARIES) {
    if (matchesAny(dictionary.closeWindow, text)) return { type: "CLOSE_WINDOW" };
  }
  for (const dictionary of LANGUAGE_DICTIONARIES) {
    if (matchesAny(dictionary.cancelTasks, text)) return { type: "CANCEL_TASKS" };
  }
  for (const dictionary of LANGUAGE_DICTIONARIES) {
    if (matchesAny(dictionary.help, text)) return { type: "HELP" };
  }

  const application = findApplication(text);
  const openVerb = LANGUAGE_DICTIONARIES.map((dictionary) => findOpenVerb(text, dictionary)).find(Boolean);
  if (openVerb) {
    const remainder = text.slice((openVerb.index ?? 0) + openVerb[0].length).trim();
    const appName = LANGUAGE_DICTIONARIES.reduce(
      (name, dictionary) => name.replace(dictionary.fillerWords, ""),
      remainder,
    ).trim();
    return { type: "OPEN_APPLICATION", appId: application?.entry.id, appName: appName || remainder };
  }

  if (LANGUAGE_DICTIONARIES.some((dictionary) => matchesAny(dictionary.systemInfo, text))) {
    return { type: "SYSTEM_INFO" };
  }

  return { type: "UNKNOWN", text };
}
