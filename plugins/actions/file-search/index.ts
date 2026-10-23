import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityHandler, CapabilityManifest } from "../../../src/core/capabilities/types";
import { formatBytes } from "../../../src/i18n/format";
import type { PresentedContent } from "../../../src/core/presentation/types";

export const FILE_SEARCH_MANIFEST: CapabilityManifest = {
  id: "files.search",
  name: "Recherche de fichiers",
  version: "1.0.0",
  description: "Recherche par extension et période, dans les dossiers utilisateur uniquement (lecture seule).",
  categories: ["files"],
  inputs: ["extension", "folderHint", "withinDays"],
  outputs: ["files"],
  dependencies: [],
  permissions: ["file.read"],
  locality: "local",
  requiredApis: [],
  timeoutMs: 60_000,
  cost: "local",
  offline: true,
};

export const fileSearch: CapabilityHandler = async (input, context) => {
  const withinDays = input.withinDays ? Number(input.withinDays) : undefined;
  const files = await context.bridge.searchFiles({
    extension: input.extension || undefined,
    folderHint: input.folderHint || undefined,
    modifiedWithinDays: withinDays,
  });
  const { t, locale } = context;
  const presentations: PresentedContent[] = files.length === 0 ? [] : [
    {
      kind: "data-table",
      title: t("files.resultsTitle"),
      columns: [t("files.col.name"), t("files.col.folder"), t("files.col.size"), t("files.col.modified")],
      rows: files.map((file) => [
        file.name,
        file.path.slice(0, Math.max(0, file.path.length - file.name.length - 1)),
        formatBytes(locale, file.size),
        new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(file.modified * 1000)),
      ]),
    },
  ];
  return {
    caption: files.length === 0 ? t("files.none") : t("files.caption", { count: files.length }),
    presentations,
    source: { capabilityId: FILE_SEARCH_MANIFEST.id, locality: "local", collectedAt: Date.now() },
    referents: files.map((file) => ({ kind: "file", label: file.name, value: file.path })),
  };
};

export function activate(api: PluginApi): void {
  api.registerCapability(FILE_SEARCH_MANIFEST, fileSearch);
}
