import type { MessageKey } from "../../i18n/messages";

/**
 * Action de chaque permission qui peut être mémorisée (« toujours autoriser »).
 * Les autres permissions (suppression, fenêtres, plugins) n'ont pas d'entrée : elles ne peuvent jamais être mémorisées.
 */
export const RULE_ACTION: Readonly<Record<string, MessageKey>> = {
  "file.write": "rule.action.fileWrite",
  "agent.run": "rule.action.agentRun",
};
