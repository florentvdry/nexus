import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityHandler, CapabilityManifest } from "../../../src/core/capabilities/types";
import { collect, required, summarize } from "../../../src/core/osint/presentation";

export const OSINT_DOMAIN_MANIFEST: CapabilityManifest = {
  id: "osint.domain",
  name: "Analyse d'un domaine",
  version: "1.0.0",
  description: "Adresses du domaine (DNS système) et noms listés dans les journaux publics de certificats. Passif.",
  categories: ["osint", "domains"],
  inputs: ["domain"],
  outputs: ["findings"],
  dependencies: [],
  permissions: ["osint.passive"],
  locality: "network",
  requiredApis: [],
  timeoutMs: 120_000,
  cost: "internet",
  offline: false,
};

export const osintDomain: CapabilityHandler = async (input, context) => {
  const domain = required(input, "domain");
  const runner = context.osint;
  const reports = [
    await collect(context, runner, "domain.dns", domain),
    await collect(context, runner, "domain.certificates", domain),
  ];
  return summarize(reports, domain, context, OSINT_DOMAIN_MANIFEST.id);
};

export function activate(api: PluginApi): void {
  api.registerCapability(OSINT_DOMAIN_MANIFEST, osintDomain);
}
