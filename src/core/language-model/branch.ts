import { parseIntent, type Intent } from "../intent/parse";
import type { Classifier } from "./benchmark";
import { validateModelIntent } from "./validate";

/** Délai maximal d'une réponse du modèle (TODO §1 : ≈ 3 s par phrase). Au-delà, la réponse est ignorée. */
export const MODEL_TIMEOUT_MS = 3000;

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

/**
 * Compréhension avec repli (TODO §1, « Branchement ») : les règles d'abord. Le modèle n'est interrogé que si
 * `parseIntent` renvoie `UNKNOWN`, et sa réponse n'est retenue que si elle est valide et arrive à temps.
 * Sans modèle, ou en cas d'échec, c'est le résultat des règles qui compte : NEXUS reste utilisable.
 */
export async function understandWithModel(
  input: string,
  classifier: Classifier | null,
  timeoutMs: number = MODEL_TIMEOUT_MS,
): Promise<UnderstoodIntent> {
  const rules = parseIntent(input).intent;
  if (rules.type !== "UNKNOWN" || classifier === null) {
    return { intent: rules, source: "rules" };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });

  try {
    const answer = await Promise.race([classifier.classify(input, controller.signal).catch(() => null), timeout]);
    const intent = answer === null ? null : validateModelIntent(answer);
    return intent ? { intent: resolveAppName(intent), source: "model" } : { intent: rules, source: "rules" };
  } finally {
    clearTimeout(timer);
  }
}
