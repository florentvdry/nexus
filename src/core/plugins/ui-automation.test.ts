import { describe, expect, it, vi } from "vitest";

import { inspectUi, invokeUi } from "../../../plugins/actions/ui-automation/index";
import type { CapabilityContext } from "../capabilities/types";
import type { NativeBridge, UiInspection } from "../native/bridge";
import { translate, type MessageKey } from "../../i18n/messages";

const inspection: UiInspection = {
  window: "Sans titre - Bloc-notes",
  process: "Notepad.exe",
  controls: [
    { role: "bouton", name: "Agrandir", enabled: true, depth: 4 },
    { role: "champ de texte", name: "Éditeur", enabled: false, depth: 2 },
  ],
  truncated: false,
};

function context(bridge: Partial<NativeBridge>): CapabilityContext {
  return {
    bridge: bridge as NativeBridge,
    t: (key: MessageKey, params?: Record<string, string | number>) => translate("fr", key, params),
    locale: "fr",
  } as unknown as CapabilityContext;
}

describe("contrôles de la fenêtre active", () => {
  it("présente les contrôles en tableau, avec leur rôle, leur nom et leur état", async () => {
    const result = await inspectUi({}, context({ uiInspect: vi.fn(async () => inspection) }));
    const [table] = result.presentations;
    expect(table).toMatchObject({
      kind: "data-table",
      rows: [
        ["bouton", "Agrandir", "activé"],
        ["champ de texte", "Éditeur", "désactivé"],
      ],
    });
    expect(result.caption).toContain("2 contrôles");
  });

  it("dit le plafond quand la lecture s'est arrêtée", async () => {
    const result = await inspectUi({}, context({ uiInspect: vi.fn(async () => ({ ...inspection, truncated: true })) }));
    expect(result.caption).toContain("Lecture arrêtée à la limite");
  });

  it("ne présente rien quand la fenêtre n'a aucun contrôle lisible", async () => {
    const result = await inspectUi({}, context({ uiInspect: vi.fn(async () => ({ ...inspection, controls: [] })) }));
    expect(result.presentations).toEqual([]);
  });

  it("n'active rien sans nom de bouton", async () => {
    const uiInvoke = vi.fn(async () => "");
    const result = await invokeUi({ name: "  " }, context({ uiInvoke }));
    expect(uiInvoke).not.toHaveBeenCalled();
    expect(result.caption).toContain("Indiquez son nom exact");
  });

  it("passe le nom au natif, qui confirme et revérifie avant d'agir", async () => {
    const uiInvoke = vi.fn(async (name: string) => name);
    const result = await invokeUi({ name: "Agrandir" }, context({ uiInvoke }));
    expect(uiInvoke).toHaveBeenCalledWith("Agrandir");
    expect(result.caption).toContain("Agrandir");
  });
});
