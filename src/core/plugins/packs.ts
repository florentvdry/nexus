import type { LanguageDictionary } from "../intent/dictionaries";
import { normalize } from "../intent/normalize";
import { replacePacks, type PluginActionEntry } from "../intent/registry";

/** Vocabulaire d'un paquet : listes de mots, jamais d'expressions régulières écrites par son auteur. */
export interface LanguagePackData {
  locale: string;
  phrases: Record<string, string[]>;
  fillers: string[];
}

export interface AliasesPackData {
  applications: { id: string; aliases: string[] }[];
}

/** Commande d'un plugin WebAssembly : déclenchée par ses expressions, exécutée par le natif. */
export interface PluginActionData {
  name: string;
  triggers: string[];
  description: string;
}

/** Paquet actif tel que le natif le renvoie. Un paquet modifié ou invalide n'apparaît jamais ici. */
export interface PluginPackData {
  id: string;
  name: string;
  version: string;
  language: LanguagePackData | null;
  aliases: AliasesPackData | null;
  actions: PluginActionData[];
}

const NEVER = /(?!)/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Expression dont les mots doivent être entiers. Les plus longs passent en premier. */
function alternation(phrases: readonly string[]): RegExp | null {
  if (phrases.length === 0) return null;
  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(?:${sorted.map(escapeRegExp).join("|")})\\b`);
}

export function dictionaryFromPack(pack: LanguagePackData): LanguageDictionary {
  const patterns = (key: string): RegExp[] => {
    const pattern = alternation(pack.phrases[key] ?? []);
    return pattern ? [pattern] : [];
  };
  const fillers = pack.fillers.length > 0 ? new RegExp(`\\b(?:${pack.fillers.map(escapeRegExp).join("|")})\\b\\s*`, "g") : NEVER;
  return {
    openVerbs: patterns("openVerbs"),
    closeAll: patterns("closeAll"),
    closeWindow: patterns("closeWindow"),
    cancelTasks: patterns("cancelTasks"),
    systemInfo: patterns("systemInfo"),
    help: patterns("help"),
    fillerWords: fillers,
  };
}

/** Enregistre les paquets actifs auprès du moteur de compréhension, en remplaçant les précédents. */
export function registerPacks(packs: readonly PluginPackData[]): void {
  const dictionaries = new Map<string, LanguageDictionary>();
  const aliases = new Map<string, string>();
  const actions: PluginActionEntry[] = [];
  for (const pack of packs) {
    if (pack.language) dictionaries.set(pack.id, dictionaryFromPack(pack.language));
    // Un alias dit un nom d'application autrement (« dis cord ») : il renvoie au nom à chercher sur le PC.
    for (const app of pack.aliases?.applications ?? []) {
      for (const alias of app.aliases) aliases.set(normalize(alias), app.id);
    }
    for (const action of pack.actions) {
      actions.push({ pluginId: pack.id, command: action.name, triggers: action.triggers });
    }
  }
  replacePacks(dictionaries, aliases, actions);
}
