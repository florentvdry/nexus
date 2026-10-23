import { type AppId, type LanguageDictionary, findApplication, matchesAny } from "./dictionaries";
import { languageDictionaries, registeredApplications } from "./registry";
import { normalize, stripWakeWord } from "./normalize";

export type Intent =
  | { type: "OPEN_APPLICATION"; appId?: AppId; appName: string }
  | { type: "SYSTEM_INFO" }
  | { type: "CLOSE_WINDOW" }
  | { type: "CLOSE_ALL_WINDOWS" }
  | { type: "CANCEL_TASKS" }
  | { type: "HELP" }
  | { type: "OSINT_DOMAIN"; domain: string }
  | { type: "OSINT_USERNAME"; username: string }
  | { type: "DOCUMENT_INSPECT"; path: string }
  | { type: "UNSUPPORTED"; reason: "email"; text: string }
  | { type: "UNKNOWN"; text: string };

export interface ParseResult {
  intent: Intent;
  normalized: string;
  /** Toujours `rules` : aucune commande n'est envoyée à un modèle de langage. */
  resolvedBy: "rules";
}

const ANALYSIS_VERB = /\b(analyse|analyser|inspecte|inspecter|cherche|chercher|recherche|rechercher|trouve|trouver|search|find|investigate|analy[sz]e|inspect|check|look up)\b/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const DOCUMENT = /\b(?:analyse|analyser|inspecte|inspecter|ouvre|ouvrir|analyze|inspect|open)\s+(?:le |la |ce |mon |the |my )?(?:fichier|document|file)\s+(.+)$/i;
const USERNAME = /\b(?:pseudo|username|nom d'utilisateur|identifiant)\s*:?\s*@?([A-Za-z0-9._-]{1,39})/i;
const DOMAIN = /(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})(?=[\s/?#,;:)."']|$)/gi;

/** Mots courants pris pour des pseudos : « recherche ce pseudo sur Internet » ne doit pas viser « sur ». */
const NOT_A_USERNAME = new Set(["sur", "de", "du", "la", "le", "les", "ce", "cette", "ces", "mon", "ma", "mes", "internet", "web", "pour", "the", "on", "this", "that", "my", "a", "an", "of", "in"]);
/** Extensions de fichiers : « fichier.pdf » n'est pas un domaine. */
const FILE_EXTENSIONS = new Set(["pdf", "txt", "doc", "docx", "xls", "xlsx", "csv", "json", "md", "png", "jpg", "jpeg", "gif", "zip", "exe", "log", "py", "js", "ts", "mp3", "mp4"]);

function cleanPath(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "").trimEnd();
}

/** Extraction des cibles depuis la saisie brute : la casse et les caractères des domaines et chemins sont préservés. */
function classifyTarget(raw: string): Intent | null {
  if (EMAIL.test(raw) && ANALYSIS_VERB.test(raw)) {
    return { type: "UNSUPPORTED", reason: "email", text: raw };
  }

  const document = raw.match(DOCUMENT);
  if (document) {
    const path = cleanPath(document[1]);
    if (path) return { type: "DOCUMENT_INSPECT", path };
  }

  const username = raw.match(USERNAME);
  if (username && ANALYSIS_VERB.test(raw) && !NOT_A_USERNAME.has(username[1].toLowerCase())) {
    return { type: "OSINT_USERNAME", username: username[1] };
  }

  if (ANALYSIS_VERB.test(raw)) {
    for (const match of raw.matchAll(DOMAIN)) {
      const domain = match[1].toLowerCase();
      if (!FILE_EXTENSIONS.has(domain.split(".").pop() ?? "")) {
        return { type: "OSINT_DOMAIN", domain };
      }
    }
  }
  return null;
}

/**
 * Classification déterministe (niveau 1 de l'architecture) : expressions régulières, dictionnaires d'alias
 * et ordre de priorité explicite. Ne fait jamais d'appel réseau.
 */
export function parseIntent(input: string): ParseResult {
  const raw = input.trim();
  const normalized = stripWakeWord(normalize(raw));
  const intent = classifyTarget(stripWakeWord(raw)) ?? classify(normalized);
  return { intent, normalized, resolvedBy: "rules" };
}

function findOpenVerb(text: string, dictionary: LanguageDictionary): RegExpMatchArray | null {
  return matchesAny(dictionary.openVerbs, text);
}

function classify(text: string): Intent {
  if (!text) return { type: "UNKNOWN", text: "" };

  for (const dictionary of languageDictionaries()) {
    if (matchesAny(dictionary.closeAll, text)) return { type: "CLOSE_ALL_WINDOWS" };
  }
  for (const dictionary of languageDictionaries()) {
    if (matchesAny(dictionary.closeWindow, text)) return { type: "CLOSE_WINDOW" };
  }
  for (const dictionary of languageDictionaries()) {
    if (matchesAny(dictionary.cancelTasks, text)) return { type: "CANCEL_TASKS" };
  }
  for (const dictionary of languageDictionaries()) {
    if (matchesAny(dictionary.help, text)) return { type: "HELP" };
  }

  const application = findApplication(text, registeredApplications());
  const openVerb = languageDictionaries().map((dictionary) => findOpenVerb(text, dictionary)).find(Boolean);
  if (openVerb) {
    const remainder = text.slice((openVerb.index ?? 0) + openVerb[0].length).trim();
    const appName = languageDictionaries().reduce(
      (name, dictionary) => name.replace(dictionary.fillerWords, ""),
      remainder,
    ).trim();
    return { type: "OPEN_APPLICATION", appId: application?.entry.id, appName: appName || remainder };
  }

  if (languageDictionaries().some((dictionary) => matchesAny(dictionary.systemInfo, text))) {
    return { type: "SYSTEM_INFO" };
  }

  return { type: "UNKNOWN", text };
}
