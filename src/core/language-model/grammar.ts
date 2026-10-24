import type { Intent } from "../intent/types";

/**
 * Intentions que le modèle peut proposer. `UNKNOWN` et `UNSUPPORTED` n'en font pas partie : elles viennent des règles.
 */
export const MODEL_INTENT_TYPES: readonly Intent["type"][] = [
  "OPEN_APPLICATION",
  "SYSTEM_INFO",
  "CLOSE_WINDOW",
  "CLOSE_ALL_WINDOWS",
  "CANCEL_TASKS",
  "HELP",
  "OSINT_DOMAIN",
  "OSINT_USERNAME",
  "DOCUMENT_INSPECT",
  "FILE_SEARCH",
  "FILE_RENAME",
  "FILE_MOVE",
  "FILE_TRASH",
  "PROCESS_LIST",
  "WINDOW_LIST",
  "WINDOW_FOCUS",
  "WINDOW_CLOSE",
  "PLUGIN_CATALOG",
  "PLUGIN_LIST",
  "PLUGIN_INSTALL",
  "PLUGIN_REMOVE",
  "PLUGIN_ACTION",
  "AGENT_RUN",
  "NEEDS_CONNECTOR",
  "REMEMBER",
  "MEMORY_LIST",
  "SCHEDULE",
  "CANCEL_SCHEDULE",
  "LIST_SCHEDULES",
  "AGENDA_TODAY",
  "DRAFT_MESSAGE",
  "SCREEN_VIEW",
  "SHOW_IMAGE",
  "SHOW_TOPIC",
  "NEWS_SUMMARY",
  "FORGET",
];

/**
 * Grammaire GBNF (llama.cpp) : la sortie est un objet JSON dont `type` est l'une des intentions connues.
 * Les champs sont libres à ce stade ; `validateModelIntent` les contrôle ensuite. Une grammaire par intention
 * resserrerait encore la sortie, en revanche le modèle se trompe moins souvent sur le type que sur les champs.
 */
export function buildIntentGrammar(types: readonly string[] = MODEL_INTENT_TYPES): string {
  if (types.length === 0) throw new Error("aucune intention à proposer au modèle");
  const alternatives = types.map((type) => `"\\"${type}\\""`).join(" | ");
  return [
    'root ::= "{" ws "\\"type\\"" ws ":" ws intent-type ws ("," ws member ws)* "}"',
    `intent-type ::= ${alternatives}`,
    'member ::= string ws ":" ws value',
    'value ::= string | number | "true" | "false" | "null"',
    'string ::= "\\"" ([^"\\\\] | "\\\\" .)* "\\""',
    'number ::= "-"? [0-9]+ ("." [0-9]+)?',
    'ws ::= [ \\t\\n]*',
    "",
  ].join("\n");
}
