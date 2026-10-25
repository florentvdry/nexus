import type { ConfirmationRequest } from "../core/native/bridge";

/** Ajoute une demande, sans doublon : la même demande peut arriver par l'événement et par la liste de reprise. */
export function addRequest(queue: ConfirmationRequest[], request: ConfirmationRequest): ConfirmationRequest[] {
  return queue.some((item) => item.id === request.id) ? queue : [...queue, request];
}

export function removeRequest(queue: ConfirmationRequest[], id: string): ConfirmationRequest[] {
  return queue.filter((item) => item.id !== id);
}
