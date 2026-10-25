import { describe, expect, it } from "vitest";

import type { SourceRef } from "../capabilities/types";
import { DEFAULT_PLACEMENT, resizeRect, type PlacementOptions } from "./placement";
import { EMPTY_WINDOWS, openWindow, resizeWindow, type WindowContext, type WindowRequest } from "./windows";
import type { PresentedContent, Rect } from "./types";

const source: SourceRef = { capabilityId: "system.info", locality: "local", collectedAt: 0 };
const card = (title: string): PresentedContent => ({ kind: "information-card", title, rows: [{ label: "Ligne", value: "valeur" }] });
const request = (id: string): WindowRequest => ({ id, content: card(id), source });

const viewport = { width: 1280, height: 800 };
const options: PlacementOptions = DEFAULT_PLACEMENT;
const context: WindowContext = {
  scene: { viewport, orb: { cx: 640, cy: 400, radius: 180 }, obstacles: [] },
  now: 1000,
};

describe("redimensionnement d'une fenêtre à la main", () => {
  it("garde la taille demandée quand elle est dans les limites, le coin haut gauche ne bouge pas", () => {
    const rect: Rect = { x: 100, y: 120, width: 300, height: 200 };
    expect(resizeRect(rect, { width: 520, height: 360 }, viewport, options)).toEqual({ x: 100, y: 120, width: 520, height: 360 });
  });

  it("ne descend jamais sous la taille minimale", () => {
    const rect: Rect = { x: 100, y: 120, width: 300, height: 200 };
    const shrunk = resizeRect(rect, { width: 10, height: 10 }, viewport, options);
    expect(shrunk.width).toBe(options.minSize.width);
    expect(shrunk.height).toBe(options.minSize.height);
  });

  it("ne déborde pas de l'écran : la fenêtre est ramenée dans les limites utiles", () => {
    const rect: Rect = { x: 900, y: 500, width: 300, height: 200 };
    const big = resizeRect(rect, { width: 5000, height: 5000 }, viewport, options);
    expect(big.x + big.width).toBeLessThanOrEqual(viewport.width - options.margin);
    expect(big.y + big.height).toBeLessThanOrEqual(viewport.height - options.margin);
    expect(big.x).toBeGreaterThanOrEqual(options.margin);
    expect(big.y).toBeGreaterThanOrEqual(options.margin);
  });

  it("la fenêtre redimensionnée passe au premier plan et sa taille souhaitée devient la nouvelle", () => {
    let state = openWindow(EMPTY_WINDOWS, request("a"), context);
    state = openWindow(state, request("b"), context);
    const resized = resizeWindow(state, "a", { width: 480, height: 330 }, context);
    expect(resized.open[resized.open.length - 1].id).toBe("a");
    const window = resized.open.find((entry) => entry.id === "a");
    expect(window?.rect).toMatchObject({ width: 480, height: 330 });
    expect(window?.desired).toEqual({ width: 480, height: 330 });
  });

  it("ne touche à rien pour une fenêtre inconnue", () => {
    const state = openWindow(EMPTY_WINDOWS, request("a"), context);
    expect(resizeWindow(state, "absente", { width: 480, height: 330 }, context)).toBe(state);
  });
});
