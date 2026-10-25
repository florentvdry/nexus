import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/**
 * Notifications Windows pour les alertes proactives. Désactivées par défaut : l'utilisateur les active dans les
 * réglages. Une alerte n'envoie rien pendant la plage silencieuse (voir le moteur) et reste dans la fenêtre de NEXUS.
 */

const STORAGE_KEY = "nexus.notifications";

export function readNotifications(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeNotifications(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Stockage indisponible : le réglage vaut pour cette session.
  }
}

/** Envoie une notification si le réglage est activé et si Windows l'autorise. Une panne n'arrête jamais NEXUS. */
export async function notify(title: string, body: string): Promise<void> {
  if (!readNotifications()) return;
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {
    // Notifications indisponibles sur ce poste : l'alerte reste affichée dans NEXUS.
  }
}
