import type { PluginApi } from "../../../src/core/plugins/types";
import { NativeCallError } from "../../../src/core/native/adapter";
import { CapabilityError } from "../../../src/core/capabilities/errors";
import type { CapabilityHandler, CapabilityManifest } from "../../../src/core/capabilities/types";

/**
 * Lancement d'une application. Aucun catalogue : le natif cherche le nom sur ce PC (menu Démarrer, registre, dossiers
 * des programmes), puis lance ce qu'il a trouvé. Aucune commande libre n'est exécutée.
 */
export const APPS_LAUNCH_MANIFEST: CapabilityManifest = {
  id: "apps.launch",
  name: "Lancement d'applications",
  version: "1.0.0",
  description: "Cherche une application installée sur ce PC par son nom, puis la lance.",
  categories: ["applications"],
  inputs: ["app-name"],
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
  const requested = typeof input.appName === "string" ? input.appName.trim() : "";
  if (!requested) throw new CapabilityError("unknown-app", { name: "" });

  let name = requested;
  try {
    name = (await native.launchApp(requested)).displayName;
  } catch (error) {
    if (error instanceof NativeCallError) {
      throw new CapabilityError(error.code, { name: requested, details: error.message });
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
}
