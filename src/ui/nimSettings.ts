/**
 * NVIDIA NIM, en option : désactivé par défaut. L'activation et le modèle sont des préférences du navigateur ; la clé
 * n'y est jamais gardée : elle est enregistrée côté natif, chiffrée par Windows, et seul son état revient ici.
 */
import type { NativeBridge } from "../core/native/bridge";
import { parseShare, type ContextShare } from "../core/language-model/context";

const ENABLED = "nexus.nim.enabled";
const MODEL = "nexus.nim.model";
const SHARE = "nexus.nim.share";
/** Emplacement de l'ancienne version, où la clé était gardée en clair dans le navigateur. */
const LEGACY_KEY = "nexus.nim.key";
export const DEFAULT_NIM_MODEL = "meta/llama-3.1-8b-instruct";

export interface NimPreferences {
  enabled: boolean;
  model: string;
}

export function readNimSettings(): NimPreferences {
  try {
    return {
      enabled: window.localStorage.getItem(ENABLED) === "1",
      model: window.localStorage.getItem(MODEL) || DEFAULT_NIM_MODEL,
    };
  } catch {
    return { enabled: false, model: DEFAULT_NIM_MODEL };
  }
}

export function writeNimSettings(settings: NimPreferences): void {
  try {
    window.localStorage.setItem(ENABLED, settings.enabled ? "1" : "0");
    window.localStorage.setItem(MODEL, settings.model.trim() || DEFAULT_NIM_MODEL);
  } catch {
    // Stockage indisponible : les préférences reviendront à leurs valeurs par défaut.
  }
}

/**
 * Catégories de contexte que NVIDIA reçoit en plus de la demande (la demande et l'heure partent toujours).
 * Par défaut, aucune : ni la conversation, ni les souvenirs, ni ce qui est affiché.
 */
export function readNimShare(): ContextShare[] {
  try {
    return parseShare(JSON.parse(window.localStorage.getItem(SHARE) ?? "[]"));
  } catch {
    return [];
  }
}

export function writeNimShare(share: ContextShare[]): void {
  try {
    window.localStorage.setItem(SHARE, JSON.stringify(parseShare(share)));
  } catch {
    // Stockage indisponible : le choix reviendra à « rien partagé », le plus sûr.
  }
}

/** Configuration pour une demande : seulement si NIM est activé. La clé est utilisée côté natif, jamais ici. */
/** Mode strict hors ligne : aucune demande ne part vers NVIDIA, même si l'option NIM est cochée. Désactivé par défaut. */
const OFFLINE_STRICT = "nexus.offlineStrict";

export function readOfflineStrict(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(OFFLINE_STRICT) === "1";
  } catch {
    return false;
  }
}

/** Activer le mode strict désactive NIM ; le réactiver se fait à la main dans la section NIM. */
export function writeOfflineStrict(on: boolean): void {
  try {
    window.localStorage.setItem(OFFLINE_STRICT, on ? "1" : "0");
  } catch {
    // Stockage indisponible : le mode vaut pour cette session.
  }
  if (on) writeNimSettings({ ...readNimSettings(), enabled: false });
}

export function readOnlineModel(): { model: string; share: ContextShare[] } | null {
  if (readOfflineStrict()) return null;
  const settings = readNimSettings();
  return settings.enabled ? { model: settings.model, share: readNimShare() } : null;
}

/**
 * Migration : une clé gardée dans le navigateur par une version précédente part dans le stockage natif chiffré, puis
 * l'entrée du navigateur est retirée. En cas d'échec, elle reste en place pour une nouvelle tentative au démarrage.
 */
export async function migrateLegacyNimKey(bridge: NativeBridge): Promise<void> {
  try {
    const key = window.localStorage.getItem(LEGACY_KEY)?.trim() ?? "";
    if (key) await bridge.nimKeySave(key);
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Enregistrement natif impossible : rien n'est retiré, la migration est reprise au prochain démarrage.
  }
}
