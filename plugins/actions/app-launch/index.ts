import type { AppEntry } from "../../../src/core/intent/dictionaries";
import type { PluginApi } from "../../../src/core/plugins/types";
import { NativeCallError } from "../../../src/core/native/adapter";
import { CapabilityError } from "../../../src/core/capabilities/errors";
import type { CapabilityHandler, CapabilityManifest } from "../../../src/core/capabilities/types";

/** Catalogue des applications lançables. Chaque identifiant doit exister dans `plugins/actions/app-launch` côté Rust. */
export const APPS: readonly AppEntry[] = [
  { id: "notepad", nameKey: "app.Notepad", aliases: ["bloc notes", "bloc note", "notepad"] },
  { id: "calculator", nameKey: "app.Calculator", aliases: ["calculatrice", "calculator", "calc"] },
  { id: "paint", nameKey: "app.Paint", aliases: ["paint", "mspaint"] },
  { id: "file-explorer", nameKey: "app.FileExplorer", aliases: ["explorateur de fichiers", "explorateur", "file explorer"] },
  { id: "chrome", nameKey: "app.Chrome", aliases: ["google chrome", "chrome"] },
  { id: "discord", nameKey: "app.Discord", aliases: ["discord"] },
];

export const APPS_LAUNCH_MANIFEST: CapabilityManifest = {
  id: "apps.launch",
  name: "Lancement d'applications",
  version: "1.0.0",
  description: "Lance une application du catalogue natif. Aucune commande libre n'est exécutée.",
  categories: ["applications"],
  inputs: ["app-id"],
  outputs: ["launch-status"],
  dependencies: [],
  permissions: ["process.launch"],
  locality: "local",
  requiredApis: [],
  timeoutMs: 15000,
  cost: "local",
  offline: true,
};

export const launchApp: CapabilityHandler = async (input, { native, t }) => {
  const entry = APPS.find((app) => app.id === input.appId);
  if (!entry) throw new CapabilityError("unknown-app", { name: input.appId ?? "" });
  const name = t(entry.nameKey);

  try {
    await native.launchApp(entry.id);
  } catch (error) {
    if (error instanceof NativeCallError) {
      throw new CapabilityError(error.code, { name, details: error.message });
    }
    throw error;
  }

  return {
    caption: t("app.opened", { app: name }),
    presentations: [],
    source: { capabilityId: APPS_LAUNCH_MANIFEST.id, locality: "local", collectedAt: Date.now() },
  };
};

export function activate(api: PluginApi): void {
  api.registerCapability(APPS_LAUNCH_MANIFEST, launchApp);
  api.registerApplications(APPS);
}
