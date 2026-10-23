import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityContext, CapabilityHandler, CapabilityInput, CapabilityManifest, CapabilityResult } from "../../../src/core/capabilities/types";
import type { WindowEntry } from "../../../src/core/native/bridge";
import { normalize } from "../../../src/core/intent/normalize";
import type { PresentedContent } from "../../../src/core/presentation/types";

/** Délai couvrant la confirmation (120 s côté natif) puis l'action. */
const ACTION_TIMEOUT_MS = 180_000;

export const WINDOW_LIST_MANIFEST: CapabilityManifest = {
  id: "window.list",
  name: "Fenêtres ouvertes",
  version: "1.0.0",
  description: "Liste les fenêtres visibles. Lecture seule.",
  categories: ["system"],
  inputs: [],
  outputs: ["windows"],
  dependencies: [],
  permissions: ["window.read"],
  locality: "local",
  requiredApis: [],
  timeoutMs: 10_000,
  cost: "local",
  offline: true,
};

export const WINDOW_FOCUS_MANIFEST: CapabilityManifest = {
  ...WINDOW_LIST_MANIFEST,
  id: "window.focus",
  name: "Activer une fenêtre",
  description: "Ramène une fenêtre au premier plan, après confirmation.",
  permissions: ["window.control"],
  timeoutMs: ACTION_TIMEOUT_MS,
  inputs: ["name"],
  outputs: [],
};

export const WINDOW_CLOSE_MANIFEST: CapabilityManifest = {
  ...WINDOW_FOCUS_MANIFEST,
  id: "window.close",
  name: "Fermer une fenêtre",
  description: "Demande à l'application de se fermer, après confirmation. Elle peut refuser ou demander d'enregistrer.",
};

/**
 * Fenêtres dont le titre ou le nom de processus contient `name`, sans tenir compte des accents ni de la casse.
 * Un nom trop court ne correspond à rien : « a » ne doit pas viser toutes les fenêtres.
 */
export function matchWindows(windows: readonly WindowEntry[], name: string): WindowEntry[] {
  const wanted = normalize(name);
  if (wanted.length < 2) return [];
  return windows.filter((window) => {
    const process = normalize(window.process.replace(/\.exe$/i, ""));
    return normalize(window.title).includes(wanted) || process.includes(wanted);
  });
}

function outcome(manifest: CapabilityManifest, caption: string, presentations: PresentedContent[] = []): CapabilityResult {
  return {
    caption,
    presentations,
    source: { capabilityId: manifest.id, locality: "local", collectedAt: Date.now() },
  };
}

export const listWindows: CapabilityHandler = async (_input, context) => {
  const windows = await context.bridge.listWindows();
  const { t } = context;
  const presentations: PresentedContent[] = windows.length === 0 ? [] : [
    {
      kind: "data-table",
      title: t("windows.title"),
      columns: [t("windows.col.title"), t("windows.col.process")],
      rows: windows.map((window) => [window.title, window.process]),
    },
  ];
  return outcome(WINDOW_LIST_MANIFEST, windows.length === 0 ? t("windows.none") : t("windows.caption", { count: windows.length }), presentations);
};

/** Trouve la fenêtre visée, ou explique pourquoi aucune action n'est engagée (aucune ou plusieurs correspondances). */
async function findTarget(input: CapabilityInput, context: CapabilityContext): Promise<WindowEntry | string> {
  const name = (input.name ?? "").trim();
  const { t } = context;
  if (normalize(name).length < 2) return t("windows.nameNeeded");
  const matches = matchWindows(await context.bridge.listWindows(), name);
  if (matches.length === 0) return t("windows.notFound", { name });
  if (matches.length > 1) return t("windows.ambiguous", { name, titles: matches.slice(0, 5).map((window) => window.title).join(" ; ") });
  return matches[0];
}

export const focusWindow: CapabilityHandler = async (input, context) => {
  const target = await findTarget(input, context);
  if (typeof target === "string") return outcome(WINDOW_FOCUS_MANIFEST, target);
  await context.bridge.focusWindow(target.id);
  return outcome(WINDOW_FOCUS_MANIFEST, context.t("windows.focused", { title: target.title }));
};

export const closeWindow: CapabilityHandler = async (input, context) => {
  const target = await findTarget(input, context);
  if (typeof target === "string") return outcome(WINDOW_CLOSE_MANIFEST, target);
  await context.bridge.closeWindow(target.id);
  return outcome(WINDOW_CLOSE_MANIFEST, context.t("windows.closeSent", { title: target.title }));
};

export function activate(api: PluginApi): void {
  api.registerCapability(WINDOW_LIST_MANIFEST, listWindows);
  api.registerCapability(WINDOW_FOCUS_MANIFEST, focusWindow);
  api.registerCapability(WINDOW_CLOSE_MANIFEST, closeWindow);
}
