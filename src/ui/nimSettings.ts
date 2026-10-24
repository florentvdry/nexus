/** NVIDIA NIM, en option : clé et modèle saisis par l'utilisateur, désactivés par défaut. Réglages locaux du navigateur. */

const ENABLED = "nexus.nim.enabled";
const KEY = "nexus.nim.key";
const MODEL = "nexus.nim.model";
export const DEFAULT_NIM_MODEL = "meta/llama-3.1-8b-instruct";

export function readNimSettings(): { enabled: boolean; key: string; model: string } {
  try {
    return {
      enabled: window.localStorage.getItem(ENABLED) === "1",
      key: window.localStorage.getItem(KEY) ?? "",
      model: window.localStorage.getItem(MODEL) || DEFAULT_NIM_MODEL,
    };
  } catch {
    return { enabled: false, key: "", model: DEFAULT_NIM_MODEL };
  }
}

export function writeNimSettings(settings: { enabled: boolean; key: string; model: string }): void {
  try {
    window.localStorage.setItem(ENABLED, settings.enabled ? "1" : "0");
    window.localStorage.setItem(KEY, settings.key.trim());
    window.localStorage.setItem(MODEL, settings.model.trim() || DEFAULT_NIM_MODEL);
  } catch {
    // Stockage indisponible : les réglages reviendront à leurs valeurs par défaut.
  }
}

/** Configuration à utiliser pour une demande : seulement si activé et avec une clé. */
export function readOnlineModel(): { key: string; model: string } | null {
  const settings = readNimSettings();
  return settings.enabled && settings.key ? { key: settings.key, model: settings.model } : null;
}
