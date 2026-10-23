import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityHandler, CapabilityManifest } from "../../../src/core/capabilities/types";
import { formatGiB, formatPercent } from "../../../src/i18n/format";
import type { PresentedContent } from "../../../src/core/presentation/types";

export const PROCESS_LIST_MANIFEST: CapabilityManifest = {
  id: "system.processes",
  name: "Processus en cours",
  version: "1.0.0",
  description: "Processus qui occupent le plus de mémoire. Lecture seule.",
  categories: ["system"],
  inputs: ["limit"],
  outputs: ["processes"],
  dependencies: [],
  permissions: ["system.read"],
  locality: "local",
  requiredApis: [],
  timeoutMs: 10_000,
  cost: "local",
  offline: true,
};

export const processList: CapabilityHandler = async (input, context) => {
  const limit = Math.min(50, Math.max(1, Number(input.limit ?? 8)));
  const processes = await context.bridge.listProcesses(limit);
  const { t, locale } = context;
  const presentations: PresentedContent[] = processes.length === 0 ? [] : [
    {
      kind: "data-table",
      title: t("processes.title"),
      columns: [t("processes.col.name"), t("processes.col.pid"), t("processes.col.memory"), t("processes.col.cpu")],
      rows: processes.map((process) => [process.name, String(process.pid), formatGiB(locale, process.memoryBytes), `${formatPercent(locale, process.cpuPercent)} %`]),
    },
  ];
  return {
    caption: t("processes.caption", { count: processes.length }),
    presentations,
    source: { capabilityId: PROCESS_LIST_MANIFEST.id, locality: "local", collectedAt: Date.now() },
  };
};

export function activate(api: PluginApi): void {
  api.registerCapability(PROCESS_LIST_MANIFEST, processList);
}
