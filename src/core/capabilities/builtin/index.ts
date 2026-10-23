import type { CapabilityRegistry } from "../registry";
import { APPS_LAUNCH_MANIFEST, launchApp } from "./apps";
import { SYSTEM_INFO_MANIFEST, systemInfo } from "./system-info";

/** Capacités livrées avec la phase 1. Chaque module s'enregistre sans connaître le moteur de présentation. */
export function registerBuiltinCapabilities(registry: CapabilityRegistry): void {
  registry.register(SYSTEM_INFO_MANIFEST, systemInfo);
  registry.register(APPS_LAUNCH_MANIFEST, launchApp);
}
