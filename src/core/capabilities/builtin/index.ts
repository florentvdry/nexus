import type { CapabilityRegistry } from "../registry";
import { APPS_LAUNCH_MANIFEST, launchApp } from "./apps";
import { SYSTEM_INFO_MANIFEST, systemInfo } from "./system-info";
import { DOCUMENT_INSPECT_MANIFEST, OSINT_DOMAIN_MANIFEST, OSINT_USERNAME_MANIFEST, documentInspect, osintDomain, osintUsername } from "./osint";

/** Capacités livrées avec la phase 1. Chaque module s'enregistre sans connaître le moteur de présentation. */
export function registerBuiltinCapabilities(registry: CapabilityRegistry): void {
  registry.register(SYSTEM_INFO_MANIFEST, systemInfo);
  registry.register(APPS_LAUNCH_MANIFEST, launchApp);
  registry.register(OSINT_DOMAIN_MANIFEST, osintDomain);
  registry.register(OSINT_USERNAME_MANIFEST, osintUsername);
  registry.register(DOCUMENT_INSPECT_MANIFEST, documentInspect);
}
