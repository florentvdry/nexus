import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityHandler, CapabilityManifest } from "../../../src/core/capabilities/types";
import { collect, required, summarize } from "../../../src/core/osint/presentation";

export const DOCUMENT_INSPECT_MANIFEST: CapabilityManifest = {
  id: "document.inspect",
  name: "Analyse locale d'un fichier",
  version: "1.0.0",
  description: "Empreinte SHA-256, taille, type et statistiques d'un fichier désigné. Rien n'est envoyé.",
  categories: ["documents"],
  inputs: ["path"],
  outputs: ["findings"],
  dependencies: [],
  permissions: ["file.read"],
  locality: "local",
  requiredApis: [],
  timeoutMs: 30_000,
  cost: "local",
  offline: true,
};

export const documentInspect: CapabilityHandler = async (input, context) => {
  const path = required(input, "path");
  const report = await collect(context, context.osint, "document.inspect", path);
  return summarize([report], path.split(/[\\/]/).pop() ?? path, context, DOCUMENT_INSPECT_MANIFEST.id);
};

export function activate(api: PluginApi): void {
  api.registerCapability(DOCUMENT_INSPECT_MANIFEST, documentInspect);
}
