import type { Intent } from "../intent/types";
import type { Classifier } from "./benchmark";
import { validateModelIntent } from "./validate";

export interface UnderstoodIntent {
  intent: Intent;
  /**
   * `model` quand le modèle a répondu. `unavailable` quand aucun modèle n'a répondu : rien n'est deviné à la place,
   * l'interface le dit à l'utilisateur.
   */
  source: "model" | "unavailable";
}

const MAX_REPLY_LENGTH = 500;

/**
 * Réponse en langage naturel : le modèle n'a reconnu aucune commande (`UNKNOWN`) mais a écrit un `reply`.
 * Ce texte est affiché tel quel, à la place d'un message d'erreur.
 */
function chatReply(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.type !== "UNKNOWN" || typeof candidate.reply !== "string") return null;
  const reply = candidate.reply.trim();
  return reply.length > 0 && reply.length <= MAX_REPLY_LENGTH ? reply : null;
}

/**
 * Compréhension : toute demande passe par le modèle local, et sa réponse est validée avant usage. Aucun délai par
 * défaut : une machine lente attend sa réponse. `timeoutMs` est facultatif : seul un appelant qui le demande fixe
 * une limite (ex. des tests).
 */
export async function understandWithModel(input: string, classifier: Classifier | null, timeoutMs?: number): Promise<UnderstoodIntent> {
  if (classifier === null) return { intent: { type: "UNKNOWN", text: input }, source: "unavailable" };

  const answer = timeoutMs === undefined ? await classifier.classify(input).catch(() => null) : await withLimit(classifier, input, timeoutMs);
  if (answer === null) return { intent: { type: "UNKNOWN", text: input }, source: "unavailable" };
  const reply = chatReply(answer);
  if (reply !== null) return { intent: { type: "CHAT", text: reply }, source: "model" };
  const intent = validateModelIntent(answer);
  return intent ? { intent, source: "model" } : { intent: { type: "UNKNOWN", text: input }, source: "model" };
}

/** Réponse du modèle avec une limite explicite. Au-delà, la requête est annulée et l'on renvoie `null`. */
async function withLimit(classifier: Classifier, input: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    return await Promise.race([classifier.classify(input, controller.signal).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
