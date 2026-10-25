import { describe, expect, it } from "vitest";

import type { SourceRef } from "../capabilities/types";
import {
  EMPTY_WINDOWS,
  closeAllWindows,
  closeLastWindow,
  closeWindow,
  focusWindow,
  moveWindow,
  openWindow,
  reopenFromHistory,
  type WindowContext,
  type WindowRequest,
} from "./windows";
import { intersects, type PlacementScene } from "./placement";
import type { PresentedContent } from "./types";

const source: SourceRef = { capabilityId: "system.info", locality: "local", collectedAt: 0 };
const card = (title: string): PresentedContent => ({
  kind: "information-card",
  title,
  rows: [{ label: "Ligne", value: "valeur" }],
});

const scene: Omit<PlacementScene, "occupied"> = {
  viewport: { width: 1280, height: 800 },
  orb: { cx: 640, cy: 400, radius: 180 },
  obstacles: [{ x: 16, y: 16, width: 260, height: 150 }],
};
const context: WindowContext = { scene, now: 1000 };

function request(id: string): WindowRequest {
  return { id, content: card(id), source };
}

describe("gestion des fenêtres", () => {
  it("n'ouvre jamais deux fois la même fenêtre : elle passe au premier plan", () => {
    let state = EMPTY_WINDOWS;
    state = openWindow(state, request("a"), context);
    state = openWindow(state, request("b"), context);
    const again = openWindow(state, { id: "a-bis", content: card("a"), source }, context);
    expect(again.open).toHaveLength(2);
    expect(again.open.at(-1)?.id).toBe("a");
    expect(again.open.some((window) => window.id === "a-bis")).toBe(false);
  });

  it("garde deux confirmations distinctes, même texte, car chacune attend sa propre réponse", () => {
    const confirmation = (requestId: string): PresentedContent => ({
      kind: "confirmation",
      requestId,
      title: "Supprimer ?",
      rows: [],
      approve: "Autoriser",
      refuse: "Refuser",
    });
    let state = openWindow(EMPTY_WINDOWS, { id: "c1", content: confirmation("p1"), source }, context);
    state = openWindow(state, { id: "c2", content: confirmation("p2"), source }, context);
    expect(state.open).toHaveLength(2);
  });

  it("rouvrir depuis l'historique une fenêtre déjà ouverte ne la duplique pas", () => {
    let state = openWindow(EMPTY_WINDOWS, request("a"), context);
    state = closeWindow(state, "a", 1);
    // Le même contenu est présenté de nouveau : une fenêtre ouverte, et l'ancienne entrée reste dans l'historique.
    state = openWindow(state, { id: "a2", content: card("a"), source }, context);
    const reopened = reopenFromHistory(state, "a", context);
    expect(reopened.open.map((window) => window.id)).toEqual(["a2"]);
    expect(reopened.history.some((entry) => entry.id === "a")).toBe(false);
  });

  it("ouvre des fenêtres sans chevauchement", () => {
    let state = EMPTY_WINDOWS;
    for (const id of ["a", "b", "c"]) state = openWindow(state, request(id), context);

    expect(state.open.map((window) => window.id)).toEqual(["a", "b", "c"]);
    const [first, second, third] = state.open.map((window) => window.rect);
    expect(intersects(first, second)).toBe(false);
    expect(intersects(second, third)).toBe(false);
    expect(intersects(first, third)).toBe(false);
  });

  it("déplace la plus ancienne fenêtre dans l'historique quand l'écran est saturé", () => {
    const roomy: WindowContext = { ...context, scene: { ...scene, viewport: { width: 900, height: 560 }, orb: { cx: 450, cy: 280, radius: 150 }, obstacles: [] } };
    let state = EMPTY_WINDOWS;
    for (let index = 0; index < 30; index += 1) state = openWindow(state, request(`w${index}`), roomy);

    expect(state.open.at(-1)?.id).toBe("w29");
    expect(state.open.length).toBeLessThan(30);
    expect(state.history.some((entry) => entry.reason === "evicted")).toBe(true);
    const visible = state.open.map((window) => window.rect);
    visible.forEach((rect, index) => {
      expect(visible.slice(index + 1).some((other) => intersects(rect, other))).toBe(false);
    });
  });

  it("ferme la dernière fenêtre puis toutes, et conserve l'historique", () => {
    let state = openWindow(openWindow(EMPTY_WINDOWS, request("a"), context), request("b"), context);
    state = closeLastWindow(state, 2000);
    expect(state.open.map((window) => window.id)).toEqual(["a"]);
    expect(state.history[0]).toMatchObject({ id: "b", reason: "closed" });

    state = closeAllWindows(state, 3000);
    expect(state.open).toEqual([]);
    expect(state.history.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("rouvre une fenêtre depuis l'historique", () => {
    let state = openWindow(EMPTY_WINDOWS, request("a"), context);
    state = closeLastWindow(state, 2000);
    state = reopenFromHistory(state, "a", context);
    expect(state.open.map((window) => window.id)).toEqual(["a"]);
    expect(state.history).toEqual([]);
  });

  it("met au premier plan et clamp les déplacements dans l'écran", () => {
    let state = openWindow(openWindow(EMPTY_WINDOWS, request("a"), context), request("b"), context);
    state = focusWindow(state, "a");
    expect(state.open.at(-1)?.id).toBe("a");

    state = moveWindow(state, "a", { x: 5000, y: 5000, width: 340, height: 200 }, context);
    const moved = state.open.find((window) => window.id === "a")?.rect;
    expect(moved).toBeDefined();
    expect((moved?.x ?? 0) + (moved?.width ?? 0)).toBeLessThanOrEqual(1280);
    expect((moved?.y ?? 0) + (moved?.height ?? 0)).toBeLessThanOrEqual(800);
  });
});
