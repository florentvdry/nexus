import { describe, expect, it } from "vitest";

import {
  DEFAULT_PLACEMENT,
  circleIntersectsRect,
  contains,
  fitIntoBounds,
  intersects,
  isFreePlacement,
  placeWindow,
  reflowWindows,
  type PlacementScene,
} from "./placement";
import type { Rect } from "./types";

const viewport = { width: 1280, height: 800 };
const orb = { cx: 640, cy: 400, radius: 180 };
const hud: Rect[] = [
  { x: 16, y: 16, width: 260, height: 150 },
  { x: 380, y: 700, width: 520, height: 84 },
];

function scene(occupied: Rect[] = []): PlacementScene {
  return { viewport, orb, obstacles: hud, occupied };
}

function overlapsAny(rect: Rect, others: Rect[]): boolean {
  return others.some((other) => intersects(rect, other));
}

describe("géométrie", () => {
  it("détecte les intersections et l'inclusion", () => {
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 5, height: 5 })).toBe(true);
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBe(false);
    expect(contains({ x: 0, y: 0, width: 100, height: 100 }, { x: 90, y: 90, width: 10, height: 10 })).toBe(true);
    expect(contains({ x: 0, y: 0, width: 100, height: 100 }, { x: 95, y: 90, width: 10, height: 10 })).toBe(false);
  });

  it("détecte le recouvrement d'un cercle", () => {
    expect(circleIntersectsRect({ cx: 0, cy: 0, radius: 10 }, { x: 8, y: 8, width: 20, height: 20 })).toBe(false);
    expect(circleIntersectsRect({ cx: 0, cy: 0, radius: 10 }, { x: 2, y: 2, width: 20, height: 20 })).toBe(true);
  });
});

describe("placeWindow", () => {
  it("place une fenêtre sans chevaucher l'orbe ni les zones HUD", () => {
    const outcome = placeWindow(scene(), { width: 340, height: 240 });
    expect(outcome.placed).toBe(true);
    if (!outcome.placed) return;
    expect(outcome.rect.width).toBe(340);
    expect(isFreePlacement(outcome.rect, scene(), DEFAULT_PLACEMENT)).toBe(true);
    expect(overlapsAny(outcome.rect, hud)).toBe(false);
  });

  it("ne place jamais deux fenêtres au même endroit et sépare les résultats", () => {
    const placed: Rect[] = [];
    for (let index = 0; index < 4; index += 1) {
      const outcome = placeWindow(scene(placed), { width: 340, height: 220 });
      expect(outcome.placed).toBe(true);
      if (!outcome.placed) return;
      expect(overlapsAny(outcome.rect, placed)).toBe(false);
      placed.push(outcome.rect);
    }
    const origins = new Set(placed.map((rect) => `${rect.x},${rect.y}`));
    expect(origins.size).toBe(placed.length);
  });

  it("réduit la taille quand la taille souhaitée ne rentre pas autour de l'orbe", () => {
    // 500 × 600 ne rentre nulle part à côté de l'orbe ; 85 % de la largeur (425 px) rentre à gauche.
    const outcome = placeWindow({ ...scene(), obstacles: [] }, { width: 500, height: 600 });
    expect(outcome).toMatchObject({ placed: true, shrunk: true, rect: { width: 425, height: 510 } });
  });

  it("signale l'absence d'espace au lieu de forcer un emplacement", () => {
    const tiny = { ...scene(), viewport: { width: 400, height: 300 }, orb: { cx: 200, cy: 150, radius: 120 }, obstacles: [] };
    expect(placeWindow(tiny, { width: 340, height: 240 })).toEqual({ placed: false, reason: "no-space" });
  });

  it("garde l'orbe visible : aucune fenêtre ne couvre son cercle d'exclusion", () => {
    for (let index = 0; index < 6; index += 1) {
      const outcome = placeWindow(scene(), { width: 300, height: 200 });
      if (!outcome.placed) continue;
      expect(circleIntersectsRect({ ...orb, radius: orb.radius + DEFAULT_PLACEMENT.gap }, outcome.rect)).toBe(false);
    }
  });
});

describe("fitIntoBounds et reflowWindows", () => {
  it("ramène une fenêtre hors écran dans les limites", () => {
    const fitted = fitIntoBounds({ x: 1200, y: 760, width: 340, height: 240 }, viewport, 16);
    expect(contains({ x: 16, y: 16, width: 1248, height: 768 }, fitted)).toBe(true);
  });

  it("conserve les fenêtres valides et replace celles qui gênent après un redimensionnement", () => {
    const smaller = { width: 900, height: 560 };
    const kept: Rect = { x: 600, y: 16, width: 280, height: 150 };
    const misplaced: Rect = { x: 620, y: 300, width: 340, height: 200 };
    const result = reflowWindows(
      { viewport: smaller, orb: { cx: 450, cy: 280, radius: 150 }, obstacles: [] },
      [
        { id: "a", rect: kept, desired: { width: 340, height: 200 } },
        { id: "b", rect: misplaced, desired: { width: 340, height: 200 } },
      ],
    );

    expect(result.overflow).toEqual([]);
    expect(result.placed.find((entry) => entry.id === "a")?.rect).toEqual(kept);
    const replaced = result.placed.find((entry) => entry.id === "b")?.rect;
    expect(replaced).toBeDefined();
    expect(intersects(replaced as Rect, kept)).toBe(false);
  });

  it("signale les fenêtres qui n'ont plus de place", () => {
    const result = reflowWindows(
      { viewport: { width: 420, height: 320 }, orb: { cx: 210, cy: 160, radius: 150 }, obstacles: [] },
      [{ id: "only", rect: { x: 0, y: 0, width: 340, height: 240 }, desired: { width: 340, height: 240 } }],
    );
    expect(result.placed).toEqual([]);
    expect(result.overflow).toEqual(["only"]);
  });
});
