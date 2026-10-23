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

/** Remplace tous les apports des paquets (appelé à chaque changement d'installation). */
export function replacePacks(dictionariesByPack: Map<string, LanguageDictionary>, aliasesByApp: Map<string, readonly string[]>): void {
  packDictionaries = dictionariesByPack;
  packAliases = aliasesByApp;
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
