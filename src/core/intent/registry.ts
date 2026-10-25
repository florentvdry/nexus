import type { LanguageDictionary } from "./dictionaries";
import { normalize } from "./normalize";

/**
 * Données de compréhension fournies par les plugins. Elles sont remplacées (et non cumulées) à chaque
 * activation : charger le même plugin deux fois ne duplique rien.
 */
const dictionaries = new Map<string, LanguageDictionary>();
/** Vocabulaire fourni par les paquets de données installés : ils complètent, ils ne remplacent pas. */
let packDictionaries = new Map<string, LanguageDictionary>();
/** Nom dit par l'utilisateur (normalisé) -> nom à chercher sur le PC. Aucune liste d'applications n'est tenue ici. */
let packAliases = new Map<string, string>();
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
  aliasTargets: Map<string, string>,
  actions: PluginActionEntry[] = [],
): void {
  packDictionaries = dictionariesByPack;
  packAliases = aliasTargets;
  packActions = actions;
}

/**
 * Commandes des plugins installés, pour le modèle : identifiant du plugin, nom de la commande, et exemples de
 * formulations. Le modèle choisit la commande ; rien n'est reconnu par correspondance de texte.
 */
export function pluginCommandsForModel(): string[] {
  return packActions.map((action) => `${action.pluginId} / ${action.command} (ex. : ${action.triggers.join(", ")})`);
}

/**
 * La commande d'un plugin installé quand le modèle l'a omise : la seule commande du plugin, sinon celle dont un
 * déclencheur déclaré par le plugin figure dans la demande (« convertis », « convertir »). Aucun déclencheur reconnu :
 * `undefined`, et rien n'est lancé.
 */
export function commandFor(pluginId: string, request: string): string | undefined {
  const commands = packActions.filter((action) => action.pluginId === pluginId);
  if (commands.length === 1) return commands[0].command;
  const words = new Set(normalize(request).split(" ").filter(Boolean));
  return commands.find((action) => action.triggers.some((trigger) => words.has(normalize(trigger))))?.command;
}

export function registerLanguageDictionary(locale: string, dictionary: LanguageDictionary): void {
  dictionaries.set(locale, dictionary);
}

export function languageDictionaries(): LanguageDictionary[] {
  return [...dictionaries.values(), ...packDictionaries.values()];
}

/**
 * Le nom à chercher sur le PC pour un nom dit par l'utilisateur : celui d'un alias installé, sinon le nom lui-même.
 */
export function applicationSearchName(spokenName: string): string {
  const normalized = normalize(spokenName);
  return packAliases.get(normalized) ?? spokenName.trim();
}
