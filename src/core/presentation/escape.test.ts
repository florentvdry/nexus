import { describe, expect, it } from "vitest";

import { escapeTarget, EMPTY_WINDOWS, type OpenWindow } from "./windows";

const window = (id: string, kind: OpenWindow["content"]["kind"]): OpenWindow =>
  ({
    id,
    content: kind === "confirmation"
      ? { kind, requestId: id, title: "t", rows: [], approve: "ok", refuse: "non" }
      : { kind: "error-card", title: "t", code: "x", message: "m" },
    source: { capabilityId: "test", locality: "local", collectedAt: 0 },
    rect: { x: 0, y: 0, width: 10, height: 10 },
    desired: { width: 10, height: 10 },
  }) as OpenWindow;

describe("Échap ferme la dernière fenêtre, jamais une confirmation", () => {
  it("rien à fermer sans fenêtre", () => {
    expect(escapeTarget(EMPTY_WINDOWS)).toBeUndefined();
  });

  it("ferme la dernière fenêtre ordinaire", () => {
    expect(escapeTarget({ open: [window("a", "error-card"), window("b", "error-card")], history: [] })?.id).toBe("b");
  });

  it("ne ferme pas une confirmation, même si c'est la dernière", () => {
    expect(escapeTarget({ open: [window("a", "error-card"), window("b", "confirmation")], history: [] })).toBeUndefined();
  });
});
