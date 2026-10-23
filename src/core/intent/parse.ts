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
  | { type: "FILE_SEARCH"; extension?: string; folderHint?: string; withinDays?: number }
  | { type: "FILE_RENAME"; path: string; newName: string }
  | { type: "FILE_MOVE"; path: string; toDir: string }
  | { type: "FILE_TRASH"; path: string }
  | { type: "PROCESS_LIST" }
  | { type: "AGENT_RUN"; project?: string; prompt?: string }
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
/** Chemin absolu (Windows ou POSIX), éventuellement entre guillemets. */
const ABSOLUTE_PATH = String.raw`"[^"]+"|'[^']+'|[A-Za-z]:[\\/][^\s"]*(?:\s+[^\s"]+)*?(?=\s+(?:en|to|dans|vers|into|et|and)\b|$)|\/[^\s"]+`;

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").trim();
}

const AGENT_VERB = /\b(lance|lancer|demarre|demarrer|ouvre|ouvrir|demande|envoie|utilise|start|launch|run|ask|use)\b/i;
const AGENT_NAME = /\bclaude\s*code\b/i;
const AGENT_PROMPT = /(?:\s:\s*|\b(?:demande|dis)[- ]lui(?:\s+de)?\s+|\bask (?:it )?to\s+)(.+)$/i;
const AGENT_PROJECT = new RegExp(String.raw`\b(?:dans|sur|in|on)\s+(${ABSOLUTE_PATH})`, "i");
const FILE_SEARCH_VERB = /\b(cherche|chercher|recherche|rechercher|trouve|trouver|liste|lister|find|search|list)\b/i;
const FILE_NOUN = /\bfichiers?\b|\bfiles?\b/i;
const FILE_EXTENSION = /\b(pdf|docx?|xlsx?|pptx?|txt|md|csv|json|png|jpe?g|gif|zip|mp3|mp4)\b/i;
const FILE_RENAME = new RegExp(String.raw`\b(?:renomme|renommer|rename)\s+(?:le |la |ce |mon )?(?:fichier\s+)?(${ABSOLUTE_PATH})\s+(?:en|to)\s+(.+)$`, "i");
const FILE_MOVE = new RegExp(String.raw`\b(?:d[ée]place|d[ée]placer|move)\s+(?:le |la |ce |mon )?(?:fichier\s+)?(${ABSOLUTE_PATH})\s+(?:dans|vers|into|to)\s+(.+)$`, "i");
const FILE_TRASH = new RegExp(String.raw`\b(?:supprime|supprimer|efface|effacer|delete|remove)\s+(?:le |la |ce |mon )?(?:fichier\s+|dossier\s+)?(${ABSOLUTE_PATH})\s*$`, "i");
const PROCESS_LIST = /\b(processus|processes|applications? (?:actives?|ouvertes?|en cours)|quelles applications|which applications|running apps)\b/i;

function searchPeriod(raw: string): number | undefined {
  if (/\bcette annee\b|\bthis year\b/i.test(raw)) return 365;
  if (/\bce mois\b|\bthis month\b/i.test(raw)) return 30;
  if (/\bcette semaine\b|\bthis week\b/i.test(raw)) return 7;
  if (/\baujourd'?hui\b|\btoday\b/i.test(raw)) return 1;
  return undefined;
}

function folderHint(raw: string): string | undefined {
  if (/t[ée]l[ée]charg|download/i.test(raw)) return "downloads";
  if (/\bdocuments?\b/i.test(raw)) return "documents";
  if (/\bbureau\b|\bdesktop\b/i.test(raw)) return "desktop";
  if (/\bimages?\b|\bpictures?\b|\bphotos?\b/i.test(raw)) return "pictures";
  return undefined;
}

function classifyNative(raw: string): Intent | null {
  if (AGENT_NAME.test(raw) && AGENT_VERB.test(raw)) {
    const prompt = raw.match(AGENT_PROMPT)?.[1]?.trim();
    const before = prompt ? raw.slice(0, raw.indexOf(prompt)) : raw;
    const project = before.match(AGENT_PROJECT)?.[1];
    return { type: "AGENT_RUN", project: project ? unquote(project) : undefined, prompt };
  }

  const rename = raw.match(FILE_RENAME);
  if (rename) return { type: "FILE_RENAME", path: unquote(rename[1]), newName: unquote(rename[2]) };

  const move = raw.match(FILE_MOVE);
  if (move) return { type: "FILE_MOVE", path: unquote(move[1]), toDir: unquote(move[2]) };

  const trash = raw.match(FILE_TRASH);
  if (trash) return { type: "FILE_TRASH", path: unquote(trash[1]) };

  if (PROCESS_LIST.test(raw)) return { type: "PROCESS_LIST" };

  const hasPath = /[\\/]/.test(raw);
  if (FILE_SEARCH_VERB.test(raw) && FILE_NOUN.test(raw) && !hasPath) {
    return {
      type: "FILE_SEARCH",
      extension: raw.match(FILE_EXTENSION)?.[1]?.toLowerCase(),
      folderHint: folderHint(raw),
      withinDays: searchPeriod(raw),
    };
  }
  return null;
}

function classifyTarget(raw: string): Intent | null {
  const native = classifyNative(raw);
  if (native) return native;

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
