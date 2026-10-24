import { afterEach, describe, expect, it, vi } from "vitest";

import { scriptedBridge, TEST_MODEL } from "../testing/scripted";
import type { RoutineStorage } from "../routines/detector";
import { createEngine, type EngineEvent } from "./engine";

const NATIVE = { systemInfo: vi.fn(), launchApp: vi.fn(), listApps: vi.fn(async () => []) };

function memoryStorage(): RoutineStorage {
  const items = new Map<string, string>();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) };
}

function setup() {
  const scheduleSave = vi.fn(async () => {});
  const bridge = scriptedBridge(
    { "affiche une photo de Macron": { type: "SHOW_IMAGE", query: "Emmanuel Macron" }, oui: { type: "UNKNOWN", text: "oui" }, non: { type: "UNKNOWN", text: "non" } },
    {
      webPhoto: vi.fn(async () => ({ title: "Macron.jpg", dataUrl: "data:image/jpeg;base64,AAAA", credit: "Auteur", license: "CC BY 2.0", page: "https://commons.wikimedia.org/wiki/File:Macron.jpg" })),
      scheduleSave,
      scheduleList: vi.fn(async () => []),
    },
  );
  const engine = createEngine({ native: NATIVE, bridge, osint: { run: vi.fn() }, model: () => TEST_MODEL, locale: "fr", responseHoldMs: 0, routineStorage: memoryStorage() });
  const events: EngineEvent[] = [];
  engine.subscribe((event) => events.push(event));
  const assistant = () => events.flatMap((event) => (event.type === "message" && event.role === "assistant" ? [event.text] : []));
  return { engine, assistant, scheduleSave, bridge };
}

afterEach(() => vi.useRealTimers());

describe("routines : proposées après trois jours, programmées seulement après « oui »", () => {
  it("la réponse arrive d'abord ; la proposition vient après ; « oui » programme chaque jour", async () => {
    vi.useFakeTimers();
    const { engine, assistant, scheduleSave } = setup();
    for (const day of [20, 21, 22]) {
      vi.setSystemTime(new Date(2026, 9, day, 8, 0));
      await engine.submit("affiche une photo de Macron");
    }
    const messages = assistant();
    const proposal = messages.findIndex((text) => text.includes("programme chaque jour à 08:00"));
    expect(proposal).toBeGreaterThan(0);
    expect(messages[proposal - 1]).toContain("Photo : Macron.jpg");
    expect(scheduleSave).not.toHaveBeenCalled();

    await engine.submit("oui");
    expect(scheduleSave).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ request: "affiche une photo de Macron", recurrence: { kind: "daily", time: "08:00" } })]),
    );
  });

  it("« non » ne programme rien", async () => {
    vi.useFakeTimers();
    const { engine, assistant, scheduleSave } = setup();
    for (const day of [20, 21, 22]) {
      vi.setSystemTime(new Date(2026, 9, day, 8, 0));
      await engine.submit("affiche une photo de Macron");
    }
    await engine.submit("non");
    expect(scheduleSave).not.toHaveBeenCalled();
    expect(assistant().at(-1)).toContain("je ne programme pas");
  });
});
