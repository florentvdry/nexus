import type { AppId } from "./dictionaries";
import type { Recurrence } from "../schedule/recurrence";

/**
 * Intention reconnue. Toute demande passe par le modèle local, qui renvoie une de ces formes ; la validation
 * (`validate.ts`) et le moteur décident ensuite. Aucune règle de texte ne produit d'intention.
 */
export type Intent =
  | { type: "OPEN_APPLICATION"; appId?: AppId; appName: string }
  | { type: "SYSTEM_INFO" }
  | { type: "CLOSE_WINDOW" }
  | { type: "CLOSE_ALL_WINDOWS" }
  | { type: "CANCEL_TASKS" }
  | { type: "HELP" }
  | { type: "OSINT_DOMAIN"; domain: string }
  | { type: "OSINT_USERNAME"; username: string }
  | { type: "DOCUMENT_INSPECT"; path: string }
  | { type: "FILE_SEARCH"; extension?: string; folderHint?: string; withinDays?: number }
  | { type: "FILE_RENAME"; path: string; newName: string }
  | { type: "FILE_MOVE"; path: string; toDir: string }
  | { type: "FILE_TRASH"; path: string }
  | { type: "PROCESS_LIST" }
  | { type: "WINDOW_LIST" }
  | { type: "WINDOW_FOCUS"; name: string }
  | { type: "WINDOW_CLOSE"; name: string }
  | { type: "PLUGIN_CATALOG" }
  | { type: "PLUGIN_LIST" }
  | { type: "PLUGIN_INSTALL"; target: string }
  | { type: "PLUGIN_REMOVE"; id: string }
  | { type: "PLUGIN_ACTION"; pluginId: string; command: string; text: string }
  | { type: "AGENT_RUN"; project?: string; prompt?: string }
  | { type: "NEEDS_CONNECTOR"; service?: string; task: string }
  /** Information durable sur l'utilisateur (prénom, préférence, habitude) : enregistrée sans question. */
  | { type: "REMEMBER"; text: string }
  /** Oubli d'un souvenir qui contient `query`, ou de toute la mémoire quand `query` vaut `null` (confirmation). */
  | { type: "FORGET"; query: string | null }
  | { type: "MEMORY_LIST" }
  /** Tâche programmée : la demande est relancée à l'heure prévue. */
  | { type: "SCHEDULE"; request: string; recurrence: Recurrence }
  | { type: "LIST_SCHEDULES" }
  | { type: "CANCEL_SCHEDULE"; query: string }
  /** Une photo d'un sujet, depuis une source publique libre (Wikimedia Commons). */
  | { type: "SHOW_IMAGE"; query: string }
  /** Un résumé d'un sujet, depuis Wikipédia. */
  | { type: "SHOW_TOPIC"; query: string }
  /** Un résumé de l'actualité du jour : pas encore de source d'actualités vérifiée. */
  | { type: "NEWS_SUMMARY"; topic?: string }
  /** Les rendez-vous du jour, lus dans le fichier d'agenda désigné par l'utilisateur. */
  | { type: "AGENDA_TODAY" }
  /** Un brouillon de message : affiché pour être copié, jamais envoyé. */
  | { type: "DRAFT_MESSAGE"; recipient?: string; text: string }
  /** Une question sur ce qui est affiché à l'écran : une capture, sur confirmation, lue par le modèle de vision local. */
  | { type: "SCREEN_VIEW"; question: string }
  /** Réponse en langage naturel du modèle, pour ce qui n'est pas une commande. */
  | { type: "CHAT"; text: string }
  | { type: "UNKNOWN"; text: string };
