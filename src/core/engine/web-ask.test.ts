import { describe, expect, it, vi } from "vitest";

import { scriptedBridge, TEST_MODEL } from "../testing/scripted";
import { createEngine, type EngineEvent } from "./engine";

const NATIVE = { systemInfo: vi.fn(), launchApp: vi.fn() };

function assistantTexts(events: EngineEvent[]): string[] {
  return events.flatMap((event) => (event.type === "message" && event.role === "assistant" ? [event.text] : []));
}

describe("question ouverte sur le web", () => {
  it("cherche, lit les pages, et répond à partir d'elles en citant les sources", async () => {
    const bridge = scriptedBridge(
      { "tu connais GTA RP ?": { type: "ASK_WEB", question: "GTA RP" } },
      {
        webSearch: vi.fn(async () => [{ title: "GTA RP", url: "https://example.org/gta-rp", snippet: "Un serveur de jeu." }]),
        webRead: vi.fn(async (url: string) => ({ url, text: "GTA RP est un serveur de roleplay sur GTA V." })),
        modelJson: vi.fn(async () => ({ answer: "Oui, GTA RP est un serveur de roleplay sur GTA V." })),
      },
    );
    const engine = createEngine({ native: NATIVE, bridge, osint: { run: vi.fn() }, model: () => TEST_MODEL, locale: "fr", responseHoldMs: 0, routineStorage: undefined });
    const events: EngineEvent[] = [];
    engine.subscribe((event) => events.push(event));

    await engine.submit("tu connais GTA RP ?");

    expect(bridge.webSearch).toHaveBeenCalledWith("GTA RP");
    expect(bridge.webRead).toHaveBeenCalledWith("https://example.org/gta-rp");
    const [model, system, user] = vi.mocked(bridge.modelJson).mock.calls[0];
    expect(model).toBe(TEST_MODEL);
    expect(system).toContain("seulement elles");
    expect(JSON.parse(user)).toMatchObject({ question: "GTA RP", sources: [{ index: 1, url: "https://example.org/gta-rp" }] });
    expect(assistantTexts(events).at(-1)).toBe("Oui, GTA RP est un serveur de roleplay sur GTA V.\nSources : https://example.org/gta-rp");
  });

  it("sans résultat lisible, le dit sans appeler le modèle", async () => {
    const bridge = scriptedBridge(
      { "tu connais GTA RP ?": { type: "ASK_WEB", question: "GTA RP" } },
      { webSearch: vi.fn(async () => []), modelJson: vi.fn() },
    );
    const engine = createEngine({ native: NATIVE, bridge, osint: { run: vi.fn() }, model: () => TEST_MODEL, locale: "fr", responseHoldMs: 0, routineStorage: undefined });
    const events: EngineEvent[] = [];
    engine.subscribe((event) => events.push(event));

    await engine.submit("tu connais GTA RP ?");

    expect(bridge.modelJson).not.toHaveBeenCalled();
    expect(assistantTexts(events).at(-1)).toContain("rien trouvé de lisible");
  });

  it("une page qui ne se lit pas est remplacée par l'extrait de la recherche", async () => {
    const bridge = scriptedBridge(
      { "tu connais GTA RP ?": { type: "ASK_WEB", question: "GTA RP" } },
      {
        webSearch: vi.fn(async () => [{ title: "GTA RP", url: "https://example.org/gta-rp", snippet: "Un serveur de jeu." }]),
        webRead: vi.fn(async () => {
          throw new Error("page non textuelle");
        }),
        modelJson: vi.fn(async () => ({ answer: "Un serveur de jeu." })),
      },
    );
    const engine = createEngine({ native: NATIVE, bridge, osint: { run: vi.fn() }, model: () => TEST_MODEL, locale: "fr", responseHoldMs: 0, routineStorage: undefined });

    await engine.submit("tu connais GTA RP ?");

    expect(JSON.parse(vi.mocked(bridge.modelJson).mock.calls[0][2]).sources[0].text).toBe("Un serveur de jeu.");
  });
});
