/**
 * Contenu des demandes de confirmation : titres, libellés des lignes et carte présentée dans la fenêtre dédiée.
 * Le moteur n'affiche que l'avis ; la fenêtre de confirmation affiche la carte complète et seule peut répondre.
 */
import { translate, type Locale, type MessageKey } from "../../i18n/messages";
import type { ConfirmationRequest } from "../native/bridge";
import type { PresentedContent } from "../presentation/types";

export type ConfirmationCardContent = Extract<PresentedContent, { kind: "confirmation" }>;

/** Titre affiché pour chaque permission demandant une confirmation. */
const PERMISSION_TITLE: Record<string, MessageKey> = {
  "file.write": "confirm.title.fileWrite",
  "file.delete": "confirm.title.fileDelete",
  "agent.run": "confirm.title.agentRun",
  "window.control": "confirm.title.windowControl",
  "plugin.manage": "confirm.title.pluginManage",
  "connector.install": "confirm.title.connectorInstall",
  "connector.call": "confirm.title.connectorCall",
  "connector.scope": "confirm.title.connectorScope",
};

/** Libellé de chaque ligne de détail d'une demande de confirmation. */
const ROW_LABEL: Record<string, MessageKey> = {
  from: "confirm.row.from",
  to: "confirm.row.to",
  path: "confirm.row.path",
  project: "confirm.row.project",
  prompt: "confirm.row.prompt",
  window: "confirm.row.window",
  process: "confirm.row.process",
  requester: "confirm.row.requester",
  connector: "confirm.row.connector",
  tool: "confirm.row.tool",
  arguments: "confirm.row.arguments",
  command: "confirm.row.command",
  repository: "confirm.row.repository",
  variables: "confirm.row.variables",
  plugin: "confirm.row.plugin",
  version: "confirm.row.version",
  commit: "confirm.row.commit",
  kinds: "confirm.row.kinds",
  digest: "confirm.row.digest",
  source: "confirm.row.source",
  permissions: "confirm.row.permissions",
  commands: "confirm.row.commands",
  previous: "confirm.row.previous",
  scope: "confirm.row.scope",
};

export function permissionTitle(locale: Locale, permission: string): string {
  return translate(locale, PERMISSION_TITLE[permission] ?? "confirm.title.generic");
}

/** Carte de la fenêtre de confirmation : tous les paramètres de la demande, et « toujours autoriser » si permis. */
export function confirmationContent(request: ConfirmationRequest, locale: Locale): ConfirmationCardContent {
  const t = (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);
  const remember =
    request.rememberable && request.scope
      ? {
          label: t(request.permission === "agent.run" ? "confirm.remember.project" : "confirm.remember.folder", { scope: request.scope }),
        }
      : undefined;
  return {
    kind: "confirmation",
    requestId: request.id,
    title: permissionTitle(locale, request.permission),
    rows: request.rows.map((row) => ({ label: t(ROW_LABEL[row.key] ?? "confirm.row.generic"), value: row.value })),
    approve: t("confirm.approve"),
    refuse: t("confirm.refuse"),
    ...(remember ? { remember } : {}),
  };
}
