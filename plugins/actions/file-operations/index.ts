import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityHandler, CapabilityManifest } from "../../../src/core/capabilities/types";
import type { FileOperation } from "../../../src/core/native/bridge";
import { CapabilityError } from "../../../src/core/capabilities/errors";

export const FILE_OPERATIONS_MANIFEST: CapabilityManifest = {
  id: "files.operate",
  name: "Opérations sur fichiers",
  version: "1.0.0",
  description: "Renommer, déplacer, copier, envoyer à la corbeille et annuler la dernière action. Chaque action est confirmée par le natif avant exécution.",
  categories: ["files"],
  inputs: ["kind", "from", "newName", "toDir", "path"],
  outputs: ["path"],
  dependencies: [],
  permissions: ["file.write", "file.delete"],
  locality: "local",
  requiredApis: [],
  // Le délai couvre la confirmation (jusqu'à 2 minutes) et l'opération elle-même.
  timeoutMs: 180_000,
  cost: "local",
  offline: true,
};

function operationFrom(input: Record<string, string>): FileOperation {
  switch (input.kind) {
    case "rename":
      return { kind: "rename", from: input.from ?? "", newName: input.newName ?? "" };
    case "move":
      return { kind: "move", from: input.from ?? "", toDir: input.toDir ?? "" };
    case "copy":
      return { kind: "copy", from: input.from ?? "", toDir: input.toDir ?? "" };
    case "trash":
      return { kind: "trash", path: input.path ?? "" };
    case "undo":
      return { kind: "undo" };
    default:
      throw new CapabilityError("invalid-path", { details: input.kind ?? "opération inconnue" });
  }
}

export const fileOperate: CapabilityHandler = async (input, context) => {
  const operation = operationFrom(input);
  const result = await context.bridge.operateFile(operation);
  const { t } = context;
  return {
    caption: t(`files.done.${operation.kind}`, { path: result }),
    presentations: [
      {
        kind: "information-card",
        title: t("files.resultTitle"),
        rows: [{ label: t(operation.kind === "trash" ? "confirm.row.path" : "confirm.row.to"), value: result }],
      },
    ],
    source: { capabilityId: FILE_OPERATIONS_MANIFEST.id, locality: "local", collectedAt: Date.now() },
  };
};

export function activate(api: PluginApi): void {
  api.registerCapability(FILE_OPERATIONS_MANIFEST, fileOperate);
}
