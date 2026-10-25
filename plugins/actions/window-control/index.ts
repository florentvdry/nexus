import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityContext, CapabilityHandler, CapabilityInput, CapabilityManifest, CapabilityResult } from "../../../src/core/capabilities/types";
import type { WindowEntry } from "../../../src/core/native/bridge";
import type { Intent } from "../../../src/core/intent/types";
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
  return {
    ...outcome(WINDOW_LIST_MANIFEST, windows.length === 0 ? t("windows.none") : t("windows.caption", { count: windows.length }), presentations),
    referents: windows.map((window) => ({ kind: "window", label: window.title, value: `#${window.id}` })),
  };
};

type Target = { window: WindowEntry } | { outcome: CapabilityResult };

type WindowAction = "WINDOW_FOCUS" | "WINDOW_CLOSE";

/**
 * Trouve la fenêtre visée. `#<identifiant>` désigne une fenêtre précise (choisie dans une question). Un nom qui
 * correspond à plusieurs fenêtres ne déclenche rien : la réponse pose la question, avec une option par fenêtre.
 * Chaque option porte l'intention exacte : le choix ne repasse pas par le modèle.
 */
async function findTarget(manifest: CapabilityManifest, input: CapabilityInput, context: CapabilityContext, action: WindowAction): Promise<Target> {
  const name = (input.name ?? "").trim();
  const { t } = context;
  const windows = await context.bridge.listWindows();
  // Le modèle recopie souvent le libellé d'une fenêtre listée avec son identifiant : « Sans titre – Bloc-notes (#12) ».
  // Seul l'identifiant compte ; le libellé ne sert pas à désigner la fenêtre.
  const byId = /#(\d+)\)?$/.exec(name);
  if (byId) {
    const window = windows.find((candidate) => candidate.id === Number(byId[1]));
    return window ? { window } : { outcome: outcome(manifest, t("windows.gone")) };
  }
  if (normalize(name).length < 2) return { outcome: outcome(manifest, t("windows.nameNeeded")) };
  const matches = matchWindows(windows, name);
  if (matches.length === 0) return { outcome: outcome(manifest, t("windows.notFound", { name })) };
  if (matches.length === 1) return { window: matches[0] };
  const question = t("windows.ambiguous", { name });
  const verb = action === "WINDOW_CLOSE" ? "ferme" : "passe sur";
  return {
    outcome: {
      ...outcome(manifest, question),
      clarification: {
        options: matches.slice(0, 8).map((window) => {
          const reference = `#${window.id}`;
          const intent: Intent = action === "WINDOW_CLOSE" ? { type: "WINDOW_CLOSE", name: reference } : { type: "WINDOW_FOCUS", name: reference };
          return { label: `${window.title} (${window.process})`, text: `${verb} la fenêtre ${reference}`, intent };
        }),
      },
    },
  };
}

export const focusWindow: CapabilityHandler = async (input, context) => {
  const target = await findTarget(WINDOW_FOCUS_MANIFEST, input, context, "WINDOW_FOCUS");
  if ("outcome" in target) return target.outcome;
  await context.bridge.focusWindow(target.window.id);
  return outcome(WINDOW_FOCUS_MANIFEST, context.t("windows.focused", { title: target.window.title }));
};

export const closeWindow: CapabilityHandler = async (input, context) => {
  const target = await findTarget(WINDOW_CLOSE_MANIFEST, input, context, "WINDOW_CLOSE");
  if ("outcome" in target) return target.outcome;
  await context.bridge.closeWindow(target.window.id);
  return outcome(WINDOW_CLOSE_MANIFEST, context.t("windows.closeSent", { title: target.window.title }));
};

export function activate(api: PluginApi): void {
  api.registerCapability(WINDOW_LIST_MANIFEST, listWindows);
  api.registerCapability(WINDOW_FOCUS_MANIFEST, focusWindow);
  api.registerCapability(WINDOW_CLOSE_MANIFEST, closeWindow);
}
