import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityHandler, CapabilityManifest } from "../../../src/core/capabilities/types";
import { collect, required, summarize } from "../../../src/core/osint/presentation";

export const OSINT_USERNAME_MANIFEST: CapabilityManifest = {
  id: "osint.username",
  name: "Recherche de pseudo",
  version: "1.0.0",
  description: "Présence d'un pseudo sur quelques plateformes publiques. Une correspondance n'est jamais une identité.",
  categories: ["osint", "usernames"],
  inputs: ["username"],
  outputs: ["findings"],
  dependencies: [],
  permissions: ["osint.passive"],
  locality: "network",
  requiredApis: [],
  timeoutMs: 120_000,
  cost: "internet",
  offline: false,
};

export const osintUsername: CapabilityHandler = async (input, context) => {
  const username = required(input, "username");
  const report = await collect(context, context.osint, "username.profiles", username);
  return summarize([report], username, context, OSINT_USERNAME_MANIFEST.id);
};

export function activate(api: PluginApi): void {
  api.registerCapability(OSINT_USERNAME_MANIFEST, osintUsername);
}
