/**
 * Coffre Obsidian : le dossier où NEXUS écrit ses notes (dans son sous-dossier NEXUS). Réglage local (navigateur).
 * Aucun dossier n'est choisi par défaut : sans coffre, rien n'est écrit.
 */

const STORAGE_KEY = "nexus.obsidian.vault";

export function readObsidianVault(): string | null {
  try {
    const value = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
    return value && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

export function writeObsidianVault(path: string | null): void {
  try {
    if (path === null || path.trim().length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, path.trim());
  } catch {
    // Stockage indisponible : le coffre vaut pour cette session.
  }
}
