import { APPS } from "../../intent/dictionaries";
import { NativeCallError } from "../../native/adapter";
import { CapabilityError } from "../errors";
import type { CapabilityHandler, CapabilityManifest } from "../types";

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
