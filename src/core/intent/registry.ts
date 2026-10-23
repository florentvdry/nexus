import type { AppEntry, LanguageDictionary } from "./dictionaries";

/**
 * Données de compréhension fournies par les plugins. Elles sont remplacées (et non cumulées) à chaque
 * activation : charger le même plugin deux fois ne duplique rien.
 */
const dictionaries = new Map<string, LanguageDictionary>();
let applications: readonly AppEntry[] = [];
/** Vocabulaire et alias fournis par les paquets de données installés : ils complètent, ils ne remplacent pas. */
let packDictionaries = new Map<string, LanguageDictionary>();
let packAliases = new Map<string, readonly string[]>();
let packActions: PluginActionEntry[] = [];

/** Commande d'un plugin WebAssembly et ses déclencheurs normalisés. */
export interface PluginActionEntry {
  pluginId: string;
  command: string;
  triggers: string[];
}

/** Remplace tous les apports des paquets (appelé à chaque changement d'installation). */
export function replacePacks(
  dictionariesByPack: Map<string, LanguageDictionary>,
  aliasesByApp: Map<string, readonly string[]>,
  actions: PluginActionEntry[] = [],
): void {
  packDictionaries = dictionariesByPack;
  packAliases = aliasesByApp;
  packActions = actions;
}

/**
 * Commande de plugin dont un déclencheur ouvre le texte normalisé : « convertis 12 km en miles » → commande
 * `convertit`, texte « 12 km en miles ». Le déclencheur le plus long l'emporte.
 */
export function matchPluginAction(normalized: string): { pluginId: string; command: string; text: string } | null {
  let best: { pluginId: string; command: string; text: string; length: number } | null = null;
  for (const action of packActions) {
    for (const trigger of action.triggers) {
      if (normalized !== trigger && !normalized.startsWith(`${trigger} `)) continue;
      if (!best || trigger.length > best.length) {
        best = { pluginId: action.pluginId, command: action.command, text: normalized.slice(trigger.length).trim(), length: trigger.length };
      }
    }
  }
  return best ? { pluginId: best.pluginId, command: best.command, text: best.text } : null;
}

export function registerLanguageDictionary(locale: string, dictionary: LanguageDictionary): void {
  dictionaries.set(locale, dictionary);
}

export function registerApplications(entries: readonly AppEntry[]): void {
  applications = [...entries];
}

export function languageDictionaries(): LanguageDictionary[] {
  return [...dictionaries.values(), ...packDictionaries.values()];
}

export function registeredApplications(): readonly AppEntry[] {
  return applications.map((entry) => {
    const extra = packAliases.get(entry.id);
    return extra ? { ...entry, aliases: [...entry.aliases, ...extra] } : entry;
  });
}
