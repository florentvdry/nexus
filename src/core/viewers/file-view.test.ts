import { describe, expect, it, vi } from "vitest";

import { fileView } from "../../../plugins/actions/file-view/index";
import type { CapabilityContext } from "../capabilities/types";
import { translate, type MessageKey } from "../../i18n/messages";

function context(): CapabilityContext {
  return {
    signal: new AbortController().signal,
    locale: "fr",
    t: (key: MessageKey, params?: Record<string, string | number>) => translate("fr", key, params),
    progress: vi.fn(),
  } as unknown as CapabilityContext;
}

describe("capacité files.view", () => {
  it("ouvre une fenêtre de visionneuse pour un PDF désigné par son chemin, sans lire le contenu", async () => {
    const result = await fileView({ path: "C:\\Users\\ana\\Documents\\rapport.pdf" }, context());
    expect(result.presentations).toEqual([{ kind: "file-view", title: "rapport.pdf", path: "C:\\Users\\ana\\Documents\\rapport.pdf" }]);
    expect(result.caption).toBe("rapport.pdf est ouvert dans une fenêtre.");
    expect(result.source).toMatchObject({ capabilityId: "files.view", locality: "local" });
  });

  it("refuse un format que NEXUS ne sait pas afficher, avant toute lecture", async () => {
    const result = await fileView({ path: "C:\\Users\\ana\\Documents\\setup.exe" }, context());
    expect(result.presentations).toEqual([
      expect.objectContaining({ kind: "error-card", code: "view", message: expect.stringContaining(".exe") }),
    ]);
  });

  it("demande un chemin complet quand il est relatif ou absent", async () => {
    const relative = await fileView({ path: "rapport.pdf" }, context());
    expect(relative.presentations).toEqual([expect.objectContaining({ kind: "error-card", message: expect.stringContaining("chemin complet") })]);
    const missing = await fileView({}, context());
    expect(missing.presentations[0]).toMatchObject({ kind: "error-card" });
  });
});
