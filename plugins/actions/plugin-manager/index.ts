import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityContext, CapabilityHandler, CapabilityManifest, CapabilityResult } from "../../../src/core/capabilities/types";
import { CapabilityError } from "../../../src/core/capabilities/errors";
import type { CatalogEntry, InstalledPlugin } from "../../../src/core/native/bridge";
import type { PresentedContent } from "../../../src/core/presentation/types";

/** Téléchargement, examen puis deux confirmations : le délai couvre le temps de lecture de l'utilisateur. */
const ACTION_TIMEOUT_MS = 300_000;

const BASE: Omit<CapabilityManifest, "id" | "name" | "description" | "timeoutMs"> = {
  version: "1.0.0",
  categories: ["system"],
  inputs: [],
  outputs: [],
  dependencies: [],
  permissions: ["plugin.manage"],
  locality: "network",
  requiredApis: [],
  cost: "internet",
  offline: false,
};

export const PLUGIN_CATALOG_MANIFEST: CapabilityManifest = { ...BASE, id: "plugin.catalog", name: "Catalogue de plugins", description: "Liste les plugins du catalogue configuré.", outputs: ["catalog"], timeoutMs: 30_000 };
export const PLUGIN_LIST_MANIFEST: CapabilityManifest = { ...BASE, id: "plugin.list", name: "Plugins installés", description: "Liste les plugins installés et leur état.", locality: "local", cost: "local", offline: true, outputs: ["plugins"], timeoutMs: 10_000 };
export const PLUGIN_INSTALL_MANIFEST: CapabilityManifest = { ...BASE, id: "plugin.install", name: "Installer un plugin", description: "Examine puis installe un plugin, après accord.", inputs: ["target"], timeoutMs: ACTION_TIMEOUT_MS };
export const PLUGIN_REMOVE_MANIFEST: CapabilityManifest = { ...BASE, id: "plugin.remove", name: "Supprimer un plugin", description: "Supprime un plugin installé, après accord.", inputs: ["id"], locality: "local", cost: "local", offline: true, timeoutMs: ACTION_TIMEOUT_MS };
/** Exécution d'une commande déjà approuvée : aucune confirmation, les permissions sont celles du plugin installé. */
export const PLUGIN_RUN_MANIFEST: CapabilityManifest = { ...BASE, id: "plugin.run", name: "Commande de plugin", description: "Exécute une commande d'un plugin installé, avec ses permissions approuvées.", inputs: ["pluginId", "command", "text"], permissions: [], locality: "local", cost: "local", offline: true, timeoutMs: 15_000 };

const ABSOLUTE_PATH = /^([a-zA-Z]:[\\/]|\/)/;
const HTTPS = /^https:\/\//i;

function outcome(manifest: CapabilityManifest, caption: string, presentations: PresentedContent[] = []): CapabilityResult {
  return { caption, presentations, source: { capabilityId: manifest.id, locality: manifest.locality, collectedAt: Date.now() } };
}

function stateLabel(context: CapabilityContext, state: InstalledPlugin["state"]): string {
  return context.t(`plugins.state.${state}`);
}

export const catalog: CapabilityHandler = async (_input, context) => {
  const entries: CatalogEntry[] = await context.bridge.pluginIndex();
  const { t } = context;
  const presentations: PresentedContent[] = entries.length === 0 ? [] : [
    {
      kind: "data-table",
      title: t("plugins.catalog.title"),
      columns: [t("plugins.col.id"), t("plugins.col.name"), t("plugins.col.version"), t("plugins.col.kinds")],
      rows: entries.map((entry) => [entry.id, entry.name, entry.version, entry.kinds.join(", ")]),
    },
  ];
  return outcome(PLUGIN_CATALOG_MANIFEST, entries.length === 0 ? t("plugins.catalog.none") : t("plugins.catalog.caption", { count: entries.length }), presentations);
};

export const list: CapabilityHandler = async (_input, context) => {
  const plugins = await context.bridge.pluginList();
  const { t } = context;
  const presentations: PresentedContent[] = plugins.length === 0 ? [] : [
    {
      kind: "data-table",
      title: t("plugins.list.title"),
      columns: [t("plugins.col.id"), t("plugins.col.version"), t("plugins.col.state")],
      rows: plugins.map((plugin) => [plugin.id, plugin.version, stateLabel(context, plugin.state)]),
    },
  ];
  return outcome(PLUGIN_LIST_MANIFEST, plugins.length === 0 ? t("plugins.list.none") : t("plugins.list.caption", { count: plugins.length }), presentations);
};

/** Une adresse HTTPS ou un dossier local est utilisé tel quel ; un identifiant est cherché dans le catalogue. */
async function resolveSource(target: string, context: CapabilityContext): Promise<string | null> {
  if (HTTPS.test(target) || ABSOLUTE_PATH.test(target)) return target;
  const entry = (await context.bridge.pluginIndex()).find((candidate) => candidate.id === target);
  return entry?.source ?? null;
}

export const install: CapabilityHandler = async (input, context) => {
  const target = (input.target ?? "").trim();
  const { t } = context;
  if (!target) throw new CapabilityError("invalid-target", { details: t("plugins.targetNeeded") });

  const source = await resolveSource(target, context);
  if (!source) return outcome(PLUGIN_INSTALL_MANIFEST, t("plugins.notFound", { id: target }));

  // Étape 1 : examiner la source (confirmation native). Étape 2 : installer l'empreinte examinée (seconde confirmation).
  const prepared = await context.bridge.pluginPrepare(source);
  const installed = await context.bridge.pluginInstall(prepared.stagingId, prepared.digest);
  const caption = installed.state === "active"
    ? t("plugins.installed", { id: installed.id, version: installed.version })
    : t("plugins.installedInactive", { id: installed.id });
  return outcome(PLUGIN_INSTALL_MANIFEST, caption);
};

export const remove: CapabilityHandler = async (input, context) => {
  const id = (input.id ?? "").trim();
  const { t } = context;
  if (!id) throw new CapabilityError("invalid-target", { details: t("plugins.targetNeeded") });
  await context.bridge.pluginRemove(id);
  return outcome(PLUGIN_REMOVE_MANIFEST, t("plugins.removed", { id }));
};

export const run: CapabilityHandler = async (input, context) => {
  const { t } = context;
  const result = await context.bridge.pluginRun(input.pluginId ?? "", input.command ?? "", input.text ?? "");
  const presentations: PresentedContent[] = result.table ? [{ kind: "data-table", title: result.table.title, columns: result.table.columns, rows: result.table.rows }] : [];
  return outcome(PLUGIN_RUN_MANIFEST, result.caption || t("plugins.run.empty"), presentations);
};

export function activate(api: PluginApi): void {
  api.registerCapability(PLUGIN_RUN_MANIFEST, run);
  api.registerCapability(PLUGIN_CATALOG_MANIFEST, catalog);
  api.registerCapability(PLUGIN_LIST_MANIFEST, list);
  api.registerCapability(PLUGIN_INSTALL_MANIFEST, install);
  api.registerCapability(PLUGIN_REMOVE_MANIFEST, remove);
}
