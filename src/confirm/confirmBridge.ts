/**
 * Ponts de la fenêtre de confirmation. Seule cette fenêtre appelle `permission_answer` : le natif refuse la réponse de
 * toute autre fenêtre. Les demandes complètes ne viennent qu'ici.
 */
import { listen } from "@tauri-apps/api/event";

import { callNative } from "../core/native/tauri-adapter";
import type { ConfirmationRequest } from "../core/native/bridge";

const REQUEST_CHANNEL = "permissions://request";

/** Demandes qui attendent une réponse, pour reprendre celles reçues avant l'ouverture de la fenêtre. */
export function pendingConfirmations(): Promise<ConfirmationRequest[]> {
  return callNative<ConfirmationRequest[]>("confirmation_pending");
}

/** `remember` : « toujours autoriser » pour le dossier ou le projet proposé. Le natif l'ignore pour un refus. */
export function answerConfirmation(id: string, approved: boolean, remember = false): Promise<void> {
  return callNative<void>("permission_answer", { id, approved, remember });
}

export function onConfirmationRequest(listener: (request: ConfirmationRequest) => void): () => void {
  const unlisten = listen<ConfirmationRequest>(REQUEST_CHANNEL, (message) => listener(message.payload));
  return () => void unlisten.then((stop) => stop());
}
