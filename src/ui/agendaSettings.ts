/** Fichier d'agenda (.ics) choisi dans les réglages. Réglage local ; sans stockage, il n'y a simplement pas d'agenda. */

const STORAGE_KEY = "nexus.agenda.path";

export function readAgendaPath(): string | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)?.trim();
    return stored ? stored : null;
  } catch {
    return null;
  }
}

export function writeAgendaPath(path: string): void {
  try {
    const trimmed = path.trim();
    if (trimmed) window.localStorage.setItem(STORAGE_KEY, trimmed);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Stockage indisponible : le chemin devra être saisi de nouveau au prochain lancement.
  }
}
