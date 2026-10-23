import { normalize } from "./normalize";

/**
 * Dictionnaires de commandes. Chaque langue ajoute ses verbes, ses expressions régulières et ses
 * alias. Les formes sont écrites normalisées (sans accents, minuscules) : voir `normalize`.
 * Ajouter une langue = ajouter un dictionnaire à `LANGUAGE_DICTIONARIES`.
 */

export type AppId = "notepad" | "calculator" | "paint" | "file-explorer" | "chrome" | "discord";

export interface AppEntry {
  id: AppId;
  /** Clé de traduction du nom affiché (`app.*`). */
  nameKey: "app.Notepad" | "app.Calculator" | "app.Paint" | "app.FileExplorer" | "app.Chrome" | "app.Discord";
  aliases: string[];
}

export const APPS: readonly AppEntry[] = [
  { id: "notepad", nameKey: "app.Notepad", aliases: ["bloc notes", "bloc note", "notepad"] },
  { id: "calculator", nameKey: "app.Calculator", aliases: ["calculatrice", "calculator", "calc"] },
  { id: "paint", nameKey: "app.Paint", aliases: ["paint", "mspaint"] },
  { id: "file-explorer", nameKey: "app.FileExplorer", aliases: ["explorateur de fichiers", "explorateur", "file explorer"] },
  { id: "chrome", nameKey: "app.Chrome", aliases: ["google chrome", "chrome"] },
  { id: "discord", nameKey: "app.Discord", aliases: ["discord"] },
];

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

export const LANGUAGE_DICTIONARIES: readonly LanguageDictionary[] = [
  {
    openVerbs: [/\b(lance|lancer|lances|ouvre|ouvrir|ouvres|demarre|demarrer|start)\b/],
    closeAll: [/\b(ferme|fermer)\b.*\b(toutes|tous)\b|\b(toutes|tous)\b.*\b(fenetres|fermer)\b/],
    closeWindow: [/\b(ferme|fermer)\b.*\b(fenetre|cette fenetre|la fenetre|ca)\b/],
    cancelTasks: [/\b(annule|annuler|arrete|arreter|interromps|interrompre)\b/],
    systemInfo: [
      /\b(cpu|processeur|ram|memoire|disque|stockage|performances?)\b/,
      /\b(informations?|infos?|etat|statut|ressources?|utilisation)\b.*\b(pc|ordinateur|machine|systeme)\b/,
      /\b(pc|ordinateur|machine|systeme)\b.*\b(informations?|infos?|etat|statut|ressources?|utilisation)\b/,
    ],
    help: [/\b(aide|help|que peux tu faire)\b/],
    fillerWords: /^(le |la |les |l |un |une |mon |ma |mes |du |de la )+|( s il te plait| stp)$/g,
  },
  {
    openVerbs: [/\b(open|launch|start|run)\b/],
    closeAll: [/\b(close|dismiss)\b.*\b(all|every)\b|\b(all|every)\b.*\bwindows\b/],
    closeWindow: [/\b(close|dismiss)\b.*\b(window|this|that)\b/],
    cancelTasks: [/\b(cancel|abort|interrupt|stop)\b/],
    systemInfo: [
      /\b(cpu|processor|ram|memory|disk|storage|performance)\b/,
      /\b(information|info|status|resources?|usage|specs?)\b.*\b(pc|computer|machine|system)\b/,
      /\b(pc|computer|machine|system)\b.*\b(information|info|status|resources?|usage|specs?)\b/,
    ],
    help: [/\b(help|what can you do)\b/],
    fillerWords: /^(the |a |an |my )+|( please)$/g,
  },
];

export interface ApplicationMatch {
  entry: AppEntry;
  alias: string;
}

/** Renvoie l'application dont l'alias le plus long apparaît en entier dans le texte. */
export function findApplication(normalizedText: string): ApplicationMatch | undefined {
  let best: ApplicationMatch | undefined;
  for (const entry of APPS) {
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
