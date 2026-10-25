/**
 * Mode discret : l'orbe et la barre de commande seulement, sans texte ni fenêtres de résultat. Les confirmations ne
 * sont pas concernées : elles restent dans leur fenêtre dédiée. Réglage local (navigateur), désactivé par défaut.
 */

const STORAGE_KEY = "nexus.quiet";

export function readQuiet(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

/** Applique le mode à la racine (attribut lu par la feuille de style) et le retient. */
export function applyQuiet(on: boolean): void {
  if (typeof document !== "undefined") {
    if (on) document.documentElement.dataset.quiet = "true";
    else delete document.documentElement.dataset.quiet;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Stockage indisponible : le mode vaut pour cette session.
  }
}
