import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityHandler, CapabilityManifest, CapabilityResult } from "../../../src/core/capabilities/types";
import type { PresentedContent } from "../../../src/core/presentation/types";

/** Délai couvrant la confirmation (120 s côté natif) puis l'action. */
const ACTION_TIMEOUT_MS = 180_000;

export const UI_INSPECT_MANIFEST: CapabilityManifest = {
  id: "ui.inspect",
  name: "Contrôles de la fenêtre active",
  version: "1.0.0",
  description: "Liste les boutons, champs et menus de la fenêtre au premier plan, hors NEXUS. Lecture seule ; les mots de passe ne sont jamais lus.",
  categories: ["system"],
  inputs: [],
  outputs: ["controls"],
  dependencies: [],
  permissions: ["window.read"],
  locality: "local",
  requiredApis: [],
  timeoutMs: 15_000,
  cost: "local",
  offline: true,
};

export const UI_INVOKE_MANIFEST: CapabilityManifest = {
  ...UI_INSPECT_MANIFEST,
  id: "ui.invoke",
  name: "Activer un bouton",
  description: "Active un bouton de la fenêtre au premier plan, après confirmation. Le nom doit désigner un seul bouton.",
  permissions: ["window.control"],
  timeoutMs: ACTION_TIMEOUT_MS,
  inputs: ["name"],
  outputs: [],
};

function outcome(manifest: CapabilityManifest, caption: string, presentations: PresentedContent[] = []): CapabilityResult {
  return {
    caption,
    presentations,
    source: { capabilityId: manifest.id, locality: "local", collectedAt: Date.now() },
  };
}

/** Contrôles de la fenêtre active, en tableau : rôle, nom et état. Aucune valeur de champ n'est lue ni affichée. */
export const inspectUi: CapabilityHandler = async (_input, context) => {
  const { t } = context;
  const inspection = await context.bridge.uiInspect();
  const { window, controls, truncated } = inspection;
  if (controls.length === 0) return outcome(UI_INSPECT_MANIFEST, t("ui.none", { window }));
  const presentations: PresentedContent[] = [
    {
      kind: "data-table",
      title: t("ui.title", { window }),
      columns: [t("ui.col.role"), t("ui.col.name"), t("ui.col.state")],
      rows: controls.map((control) => [control.role, control.name, control.enabled ? t("ui.enabled") : t("ui.disabled")]),
    },
  ];
  const caption = t("ui.caption", { window, count: controls.length }) + (truncated ? ` ${t("ui.truncated")}` : "");
  return outcome(UI_INSPECT_MANIFEST, caption, presentations);
};

/** Active un bouton de la fenêtre active. Le natif confirme, revérifie la cible et refuse un nom ambigu. */
export const invokeUi: CapabilityHandler = async (input, context) => {
  const name = (input.name ?? "").trim();
  if (name.length === 0) return outcome(UI_INVOKE_MANIFEST, context.t("ui.nameNeeded"));
  const done = await context.bridge.uiInvoke(name);
  return outcome(UI_INVOKE_MANIFEST, context.t("ui.invoked", { name: done }));
};

export function activate(api: PluginApi): void {
  api.registerCapability(UI_INSPECT_MANIFEST, inspectUi);
  api.registerCapability(UI_INVOKE_MANIFEST, invokeUi);
}
