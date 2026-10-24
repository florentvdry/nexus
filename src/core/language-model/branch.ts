import { parseIntent, type Intent } from "../intent/parse";
import type { Classifier } from "./benchmark";
import { validateModelIntent } from "./validate";

export interface UnderstoodIntent {
  intent: Intent;
  /** D'où vient l'intention : les règles restent prioritaires, le modèle n'intervient que sur `UNKNOWN`. */
  source: "rules" | "model";
}

/**
 * Le modèle donne un nom d'application, pas son identifiant : on le retrouve avec le même vocabulaire que les règles.
 * Un nom inconnu reste sans identifiant, et la route refuse alors de lancer quoi que ce soit.
 */
function resolveAppName(intent: Intent): Intent {
  if (intent.type !== "OPEN_APPLICATION") return intent;
  const resolved = parseIntent(`lance ${intent.appName}`).intent;
  return resolved.type === "OPEN_APPLICATION" && resolved.appId ? resolved : intent;
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
 * Compréhension avec repli (TODO §1, « Branchement ») : les règles d'abord. Le modèle n'est interrogé que si
 * `parseIntent` renvoie `UNKNOWN`, et sa réponse n'est retenue que si elle est valide.
 * Aucun délai par défaut : une machine lente attend sa réponse. Sans modèle, ou en cas d'échec, c'est le résultat
 * des règles qui compte : NEXUS reste utilisable.
 *
 * `timeoutMs` est facultatif : seul un appelant qui le demande explicitement (ex. des tests) fixe une limite.
 */
export async function understandWithModel(input: string, classifier: Classifier | null, timeoutMs?: number): Promise<UnderstoodIntent> {
  const rules = parseIntent(input).intent;
  if (rules.type !== "UNKNOWN" || classifier === null) {
    return { intent: rules, source: "rules" };
  }

  const answer = timeoutMs === undefined ? await classifier.classify(input).catch(() => null) : await withLimit(classifier, input, timeoutMs);
  const reply = chatReply(answer);
  if (reply !== null) return { intent: { type: "CHAT", text: reply }, source: "model" };
  const intent = answer === null ? null : validateModelIntent(answer);
  return intent ? { intent: resolveAppName(intent), source: "model" } : { intent: rules, source: "rules" };
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
