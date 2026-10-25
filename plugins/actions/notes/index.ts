import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityHandler, CapabilityManifest, CapabilityResult } from "../../../src/core/capabilities/types";

/** Délai couvrant la confirmation (120 s côté natif) puis l'écriture. */
const WRITE_TIMEOUT_MS = 180_000;

export const NOTES_SAVE_MANIFEST: CapabilityManifest = {
  id: "notes.save",
  name: "Notes Obsidian",
  version: "1.0.0",
  description: "Écrit une note Markdown dans le sous-dossier NEXUS du coffre Obsidian, après confirmation. Une note créée par vous n'est jamais remplacée.",
  categories: ["files"],
  inputs: ["vault", "relative", "content"],
  outputs: ["path"],
  dependencies: [],
  permissions: ["file.write"],
  locality: "local",
  requiredApis: [],
  timeoutMs: WRITE_TIMEOUT_MS,
  cost: "local",
  offline: true,
};

function outcome(caption: string): CapabilityResult {
  return {
    caption,
    presentations: [],
    source: { capabilityId: NOTES_SAVE_MANIFEST.id, locality: "local", collectedAt: Date.now() },
  };
}

/** Écrit la note après confirmation du natif. Le contenu reste sur ce poste. */
export const saveNote: CapabilityHandler = async (input, context) => {
  const vault = (input.vault ?? "").trim();
  const relative = (input.relative ?? "").trim();
  const content = input.content ?? "";
  if (vault.length === 0 || relative.length === 0 || content.length === 0) return outcome(context.t("notes.missing"));
  const path = await context.bridge.noteSave(vault, relative, content);
  return outcome(context.t("notes.saved", { path }));
};

export function activate(api: PluginApi): void {
  api.registerCapability(NOTES_SAVE_MANIFEST, saveNote);
}
