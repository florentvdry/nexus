/**
 * NVIDIA NIM, en option : désactivé par défaut. L'activation et le modèle sont des préférences du navigateur ; la clé
 * n'y est jamais gardée : elle est enregistrée côté natif, chiffrée par Windows, et seul son état revient ici.
 */
import type { NativeBridge } from "../core/native/bridge";

const ENABLED = "nexus.nim.enabled";
const MODEL = "nexus.nim.model";
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

/** Configuration pour une demande : seulement si NIM est activé. La clé est utilisée côté natif, jamais ici. */
export function readOnlineModel(): { model: string } | null {
  const settings = readNimSettings();
  return settings.enabled ? { model: settings.model } : null;
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
