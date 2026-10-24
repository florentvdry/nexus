/**
 * Taille du texte, pour la lisibilité. Réglage local (navigateur), « normale » par défaut. Le stockage peut être
 * indisponible : dans ce cas la taille reste normale, sans erreur.
 */

const STORAGE_KEY = "nexus.textScale";

export function readLargeText(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "large";
  } catch {
    return false;
  }
}

/** Applique la taille à l'ensemble de l'interface (attribut sur la racine, traité par la feuille de style). */
export function applyLargeText(large: boolean): void {
  if (typeof document !== "undefined") {
    if (large) document.documentElement.dataset.textScale = "large";
    else delete document.documentElement.dataset.textScale;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, large ? "large" : "normal");
  } catch {
    // Stockage indisponible : la taille reviendra à normale au prochain lancement.
  }
}
