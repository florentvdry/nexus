import type { NativeAdapter } from "../native/adapter";
import type { Locale, MessageKey } from "../../i18n/messages";
import type { PresentedContent } from "../presentation/types";

/** local : sans réseau · network : contacte Internet ou un service distant. */
export type Locality = "local" | "network";

/**
 * Niveaux de coût, du plus sobre au plus coûteux :
 * 1 local · 2 Internet sans API payante · 3 API externe · 4 tokens de modèle de langage.
 */
export type CostTier = "local" | "internet" | "external-api" | "llm";

export type Permission = "system.read" | "process.launch";

/** Niveau d'exécution d'une permission (voir docs/PERMISSIONS.md). */
export type PermissionTier = "automatic" | "confirmation" | "restricted";

export const PERMISSION_TIERS: Record<Permission, PermissionTier> = {
  "system.read": "automatic",
  "process.launch": "automatic",
};

export interface CapabilityManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  categories: string[];
  inputs: string[];
  outputs: string[];
  dependencies: string[];
  permissions: Permission[];
  locality: Locality;
  requiredApis: string[];
  /** Délai maximal d'exécution, en millisecondes. */
  timeoutMs: number;
  cost: CostTier;
  offline: boolean;
}

export interface SourceRef {
  capabilityId: string;
  locality: Locality;
  collectedAt: number;
}

/** Résultat normalisé : une phrase courte pour l'orbe et, éventuellement, des fenêtres. */
export interface CapabilityResult {
  caption: string;
  presentations: PresentedContent[];
  source: SourceRef;
}

export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface CapabilityContext {
  signal: AbortSignal;
  native: NativeAdapter;
  locale: Locale;
  t: Translator;
}

/** Entrées sérialisables uniquement : c'est la frontière d'un futur plugin isolé. */
export type CapabilityInput = Record<string, string>;

export type CapabilityHandler = (input: CapabilityInput, context: CapabilityContext) => Promise<CapabilityResult>;
