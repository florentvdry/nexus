import { type AppId, type LanguageDictionary, findApplication, matchesAny } from "./dictionaries";
import { languageDictionaries, matchPluginAction, registeredApplications } from "./registry";
import { normalize, stripWakeWord } from "./normalize";
import { closestAlias, stripPoliteness } from "./understand";

export type Intent =
  | { type: "OPEN_APPLICATION"; appId?: AppId; appName: string; suggestion?: { appId: AppId; alias: string } }
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
  | { type: "WINDOW_LIST" }
  | { type: "WINDOW_FOCUS"; name: string }
  | { type: "WINDOW_CLOSE"; name: string }
  | { type: "PLUGIN_CATALOG" }
  | { type: "PLUGIN_LIST" }
  | { type: "PLUGIN_INSTALL"; target: string }
  | { type: "PLUGIN_REMOVE"; id: string }
  | { type: "PLUGIN_ACTION"; pluginId: string; command: string; text: string }
  | { type: "AGENT_RUN"; project?: string; prompt?: string }
  | { type: "NEEDS_CONNECTOR"; service?: string; task: string }
  /** Réponse en langage naturel du modèle, pour ce qui n'est pas une commande (salutation, bavardage). Jamais produite par les règles. */
  | { type: "CHAT"; text: string }
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
  return value.trim().replace(/^["'«]|["'»]$/g, "").trim();
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
/** Fenêtre désignée par son nom : « ferme la fenêtre Word ». « cette fenêtre » et « toutes les fenêtres » restent des commandes de NEXUS. */
const WINDOW_CLOSE = /\b(?:ferme|fermer|close)\s+(?:la |le |the )?fen[eê]tre\s+(?!(?:toutes?|cette|ce|this|all|de nexus)\b)(.+?)\s*[.!?]*$/i;
const WINDOW_FOCUS = /\b(?:passe|bascule|active|activer|affiche|montre|focus|switch)\s+(?:sur\s+|to\s+)?(?:la |le |the )?fen[eê]tre\s+(?!(?:toutes?|cette|ce|this|all)\b)(.+?)\s*[.!?]*$/i;
const WINDOW_LIST = /\b(?:liste|lister|montre|affiche|quelles?|list|show)\b.*\bfen[eê]tres\b|\bfen[eê]tres\b.*\b(?:ouvertes?|open)\b/i;
const CLOSE_VERB = /\b(?:ferme|fermer|close)\b/i;
/** Plugins : « installe le plugin <adresse ou identifiant> », « supprime le plugin <identifiant> ». */
const PLUGIN_INSTALL = /\b(?:installe|installer|install|ajoute|ajouter|add)\s+(?:le |un |the |a )?plugin\s+(.+?)\s*[.!?]*$/i;
const PLUGIN_REMOVE = /\b(?:supprime|supprimer|desinstalle|desinstaller|remove|uninstall)\s+(?:le |the )?plugin\s+([a-z0-9.-]+)\s*[.!?]*$/i;
const PLUGIN_CATALOG = /\bplugins?\b.*\b(?:disponibles?|catalogue|available|marketplace)\b|\b(?:catalogue|marketplace)\b.*\bplugins?\b/i;
const PLUGIN_LIST = /\b(?:liste|lister|list|quels?|mes|installes?)\b.*\bplugins?\b|\bplugins?\s+(?:installes?|installed)\b/i;

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

  const windowClose = raw.match(WINDOW_CLOSE);
  if (windowClose) return { type: "WINDOW_CLOSE", name: unquote(windowClose[1]) };
  const windowFocus = raw.match(WINDOW_FOCUS);
  if (windowFocus) return { type: "WINDOW_FOCUS", name: unquote(windowFocus[1]) };
  if (WINDOW_LIST.test(raw) && !CLOSE_VERB.test(raw)) return { type: "WINDOW_LIST" };

  const pluginRemove = raw.match(PLUGIN_REMOVE);
  if (pluginRemove) return { type: "PLUGIN_REMOVE", id: pluginRemove[1].toLowerCase() };
  const pluginInstall = raw.match(PLUGIN_INSTALL);
  if (pluginInstall) return { type: "PLUGIN_INSTALL", target: unquote(pluginInstall[1]) };
  if (PLUGIN_CATALOG.test(raw)) return { type: "PLUGIN_CATALOG" };
  if (PLUGIN_LIST.test(raw)) return { type: "PLUGIN_LIST" };

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
  // La politesse et les formules de question ne changent pas la demande : « peux-tu ouvrir Discord ? » = « ouvre Discord ».
  const raw = stripPoliteness(input.trim());
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
    if (application) return { type: "OPEN_APPLICATION", appId: application.entry.id, appName: appName || remainder };
    // Nom inconnu mais proche d'une application du catalogue : on demande confirmation au lieu d'échouer.
    const aliases = registeredApplications().flatMap((entry) => entry.aliases.map((alias) => ({ id: entry.id, alias: normalize(alias) })));
    const closest = closestAlias(appName || remainder, aliases);
    const suggestion = closest ? { appId: closest.id, alias: closest.alias } : undefined;
    return { type: "OPEN_APPLICATION", appId: undefined, appName: appName || remainder, suggestion };
  }

  if (languageDictionaries().some((dictionary) => matchesAny(dictionary.systemInfo, text))) {
    return { type: "SYSTEM_INFO" };
  }

  // Un plugin installé peut déclarer le déclencheur : la commande lui revient, pas à une réponse « je ne comprends pas ».
  const action = matchPluginAction(text);
  if (action) return { type: "PLUGIN_ACTION", ...action };

  return { type: "UNKNOWN", text };
}
