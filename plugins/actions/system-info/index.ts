import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityHandler, CapabilityManifest, CapabilityResult } from "../../../src/core/capabilities/types";
import { formatGiB, formatPercent, formatUptime } from "../../../src/i18n/format";

export const SYSTEM_INFO_MANIFEST: CapabilityManifest = {
  id: "system.info",
  name: "Informations système",
  version: "1.0.0",
  description: "Charge du processeur, mémoire, disques et durée de fonctionnement, lus sur la machine.",
  categories: ["system"],
  inputs: [],
  outputs: ["system-metrics"],
  dependencies: [],
  permissions: ["system.read"],
  locality: "local",
  requiredApis: [],
  timeoutMs: 8000,
  cost: "local",
  offline: true,
};

export const systemInfo: CapabilityHandler = async (_input, { native, locale, t }) => {
  const info = await native.systemInfo();
  const cpu = formatPercent(locale, info.cpuUsagePercent);
  const memoryPercent = info.memoryTotalBytes > 0 ? (info.memoryUsedBytes / info.memoryTotalBytes) * 100 : 0;
  const memory = formatPercent(locale, memoryPercent);

  const presentations: CapabilityResult["presentations"] = [
    {
      kind: "information-card",
      title: t("system.cardTitle"),
      rows: [
        { label: t("system.os"), value: info.osName },
        { label: t("system.host"), value: info.hostName },
        { label: t("system.cpu"), value: info.cpuBrand || "—" },
        { label: t("system.cores", { count: info.cpuCount }), value: `${cpu} %` },
        { label: t("system.memory"), value: `${formatGiB(locale, info.memoryUsedBytes)} / ${formatGiB(locale, info.memoryTotalBytes)}` },
        { label: t("system.uptime"), value: formatUptime(locale, info.uptimeSeconds) },
      ],
    },
  ];

  if (info.disks.length > 0) {
    presentations.push({
      kind: "data-table",
      title: t("system.disksTitle"),
      columns: [t("system.mount"), t("system.total"), t("system.available")],
      rows: info.disks.map((disk) => [
        disk.mountPoint,
        formatGiB(locale, disk.totalBytes),
        formatGiB(locale, disk.availableBytes),
      ]),
    });
  }

  return {
    caption: t("system.caption", { cpu, memory }),
    presentations,
    source: { capabilityId: SYSTEM_INFO_MANIFEST.id, locality: "local", collectedAt: Date.now() },
  };
};

export function activate(api: PluginApi): void {
  api.registerCapability(SYSTEM_INFO_MANIFEST, systemInfo);
}
