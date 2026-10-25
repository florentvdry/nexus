import { describe, expect, it, vi } from "vitest";

import { closeWindow, focusWindow, listWindows, matchWindows } from "../../../plugins/actions/window-control/index";
import type { CapabilityContext } from "../capabilities/types";
import type { NativeBridge, WindowEntry } from "../native/bridge";
import { translate, type MessageKey } from "../../i18n/messages";

const windows: WindowEntry[] = [
  { id: 101, title: "Document1 - Word", process: "WINWORD.EXE", pid: 900 },
  { id: 102, title: "Réunion équipe - Discord", process: "Discord.exe", pid: 901 },
];

function context(bridge: Partial<NativeBridge>): CapabilityContext {
  return {
    bridge: bridge as NativeBridge,
    t: (key: MessageKey, params?: Record<string, string | number>) => translate("fr", key, params),
    locale: "fr",
  } as unknown as CapabilityContext;
}

describe("correspondance des fenêtres", () => {
  it("trouve une fenêtre par son titre ou son processus, sans accents ni majuscules", () => {
    expect(matchWindows(windows, "word").map((w) => w.id)).toEqual([101]);
    expect(matchWindows(windows, "reunion").map((w) => w.id)).toEqual([102]);
    expect(matchWindows(windows, "DISCORD").map((w) => w.id)).toEqual([102]);
  });

  it("ne vise aucune fenêtre avec un nom trop court", () => {
    expect(matchWindows(windows, "a")).toEqual([]);
    expect(matchWindows(windows, "")).toEqual([]);
  });
});

describe("capacités de fenêtres", () => {
  it("liste les fenêtres dans un tableau", async () => {
    const result = await listWindows({}, context({ listWindows: vi.fn(async () => windows) }));
    expect(result.caption).toBe("2 fenêtre(s) ouverte(s).");
    expect(result.presentations).toEqual([
      expect.objectContaining({ kind: "data-table", rows: [["Document1 - Word", "WINWORD.EXE"], ["Réunion équipe - Discord", "Discord.exe"]] }),
    ]);
  });

  it("ferme la fenêtre désignée, et seulement celle-là", async () => {
    const closeWindowNative = vi.fn(async () => {});
    const result = await closeWindow({ name: "discord" }, context({ listWindows: vi.fn(async () => windows), closeWindow: closeWindowNative }));
    expect(closeWindowNative).toHaveBeenCalledExactlyOnceWith(102);
    expect(result.caption).toContain("Réunion équipe - Discord");
  });

  it("désigne la fenêtre par son identifiant même quand le modèle le recopie avec le libellé", async () => {
    const closeWindowNative = vi.fn(async () => {});
    await closeWindow({ name: "Réunion équipe - Discord (#102)" }, context({ listWindows: vi.fn(async () => windows), closeWindow: closeWindowNative }));
    expect(closeWindowNative).toHaveBeenCalledExactlyOnceWith(102);
  });

  it("n'agit pas quand aucune fenêtre ne correspond", async () => {
    const focusNative = vi.fn(async () => {});
    const result = await focusWindow({ name: "photoshop" }, context({ listWindows: vi.fn(async () => windows), focusWindow: focusNative }));
    expect(focusNative).not.toHaveBeenCalled();
    expect(result.caption).toBe("Aucune fenêtre ne correspond à « photoshop ».");
  });

  it("transmet le refus de l'utilisateur sans le masquer", async () => {
    const refused = new Error("action refusée par l'utilisateur");
    await expect(
      focusWindow({ name: "word" }, context({ listWindows: vi.fn(async () => windows), focusWindow: vi.fn(async () => { throw refused; }) })),
    ).rejects.toBe(refused);
  });
});
