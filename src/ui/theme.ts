/**
 * Thème de l'interface : « system » suit le réglage de Windows (clair ou sombre), « dark » et « light » l'imposent.
 * Réglage local (navigateur). Le stockage peut être indisponible : le thème reste celui de Windows, sans erreur.
 */

const STORAGE_KEY = "nexus.theme";

export type ThemeChoice = "system" | "dark" | "light";

export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "dark", "light"];

export function readTheme(): ThemeChoice {
  try {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Applique le thème à la racine (attribut lu par la feuille de style) et le retient. */
export function applyTheme(choice: ThemeChoice): void {
  if (typeof document !== "undefined") {
    if (choice === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = choice;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Stockage indisponible : le choix vaut pour cette session.
  }
}
