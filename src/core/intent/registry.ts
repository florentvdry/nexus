import type { AppEntry, LanguageDictionary } from "./dictionaries";

/**
 * Données de compréhension fournies par les plugins. Elles sont remplacées (et non cumulées) à chaque
 * activation : charger le même plugin deux fois ne duplique rien.
 */
const dictionaries = new Map<string, LanguageDictionary>();
let applications: readonly AppEntry[] = [];

export function registerLanguageDictionary(locale: string, dictionary: LanguageDictionary): void {
  dictionaries.set(locale, dictionary);
}

export function registerApplications(entries: readonly AppEntry[]): void {
  applications = [...entries];
}

export function languageDictionaries(): LanguageDictionary[] {
  return [...dictionaries.values()];
}

export function registeredApplications(): readonly AppEntry[] {
  return applications;
}
