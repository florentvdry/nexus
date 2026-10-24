import { describe, expect, it, vi } from "vitest";

import { scriptedBridge, TEST_MODEL } from "../testing/scripted";
import { createEngine } from "./engine";

const NATIVE = { systemInfo: vi.fn(), launchApp: vi.fn(), listApps: vi.fn(async () => []) };

describe("historique de la conversation : le modèle voit ce qui précède", () => {
  it("après une photo de Britney Spears, la question suivante reçoit ce sujet dans son contexte", async () => {
    const bridge = scriptedBridge(
      {
        "affiche une photo de Britney Spears": { type: "SHOW_IMAGE", query: "Britney Spears" },
        "elle est née en quelle année ?": { type: "SHOW_TOPIC", query: "Britney Spears" },
      },
      {
        webPhoto: vi.fn(async () => ({ title: "Britney.jpg", dataUrl: "data:image/jpeg;base64,AAAA", credit: "Auteur", license: "CC BY", page: "" })),
        webSummary: vi.fn(async () => ({ title: "Britney Spears", extract: "Chanteuse américaine.", page: "" })),
      },
    );
    const engine = createEngine({ native: NATIVE, bridge, osint: { run: vi.fn() }, model: () => TEST_MODEL, locale: "fr", responseHoldMs: 0, routineStorage: undefined });
    await engine.submit("affiche une photo de Britney Spears");
    await engine.submit("elle est née en quelle année ?");

    const calls = vi.mocked(bridge.classifyIntent).mock.calls;
    const lastContext = (calls.at(-1)?.[2] ?? []) as string[];
    const joined = lastContext.join(" | ");
    expect(joined).toContain("Conversation récente");
    expect(joined).toContain("Britney Spears");
    expect(bridge.webSummary).toHaveBeenCalledWith("Britney Spears");
  });
});
