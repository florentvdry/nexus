import type { AppEntry, LanguageDictionary } from "../intent/dictionaries";
import type { CapabilityHandler, CapabilityManifest } from "../capabilities/types";

/** Version de l'API des plugins. Un plugin déclare la version qu'il vise ; une autre version est refusée. */
export const API_VERSION = 1;

export const PLUGIN_TYPES = ["actions", "sources", "documents", "speech", "languages", "agents"] as const;
export type PluginType = (typeof PLUGIN_TYPES)[number];

/** Contenu de `plugin.json`. Le même fichier servira de fiche dans une future marketplace. */
export interface PluginManifest {
  /** `<type>.<dossier>`, p. ex. `sources.domain-analysis`. */
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  type: PluginType;
  description: string;
  author: string;
  license: string;
  /** Point d'entrée TypeScript, relatif au dossier du plugin. */
  entry: string;
  /** Modules Rust associés, p. ex. `sources::dns`. Vide pour un plugin sans code natif. */
  native: string[];
  capabilities: string[];
  connectors: string[];
  languages: string[];
  applications: boolean;
  permissions: string[];
  locality: "local" | "network";
  cost: "local" | "internet" | "external-api" | "llm";
  offline: boolean;
}

/** Ce qu'un plugin peut enregistrer. Chaque appel est vérifié contre son manifeste. */
export interface PluginApi {
  registerCapability(manifest: CapabilityManifest, handler: CapabilityHandler): void;
  registerLanguage(locale: string, dictionary: LanguageDictionary): void;
  registerApplications(entries: readonly AppEntry[]): void;
}

export interface PluginModule {
  activate(api: PluginApi): void;
}

export interface DiscoveredPlugin {
  /** Chemin relatif à `plugins/`, p. ex. `sources/domain-analysis`. */
  folder: string;
  manifest: PluginManifest;
  module: PluginModule;
}

export interface PluginStatus {
  id: string;
  folder: string;
  state: "active" | "failed";
  /** Raison de l'échec : manifeste invalide, appel non déclaré, erreur d'activation. */
  error?: string;
}
