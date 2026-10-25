import type { Circle, Rect, Size } from "./types";

export interface PlacementScene {
  viewport: Size;
  /** Orbe centrale : zone à préserver en priorité. */
  orb: Circle;
  /** Zones d'interface permanentes (tâches, barre de commande) à ne jamais recouvrir. */
  obstacles: Rect[];
  /** Fenêtres déjà affichées. */
  occupied: Rect[];
}

export interface PlacementOptions {
  margin: number;
  gap: number;
  minSize: Size;
}

export const DEFAULT_PLACEMENT: PlacementOptions = {
  margin: 16,
  gap: 14,
  minSize: { width: 260, height: 120 },
};

export type PlacementOutcome =
  | { placed: true; rect: Rect; shrunk: boolean }
  | { placed: false; reason: "no-space" };

/** Les fenêtres réduites gardent au moins 70 % de leur taille souhaitée avant abandon. */
const SIZE_FACTORS = [1, 0.85, 0.7];
/** Distance idéale entre le bord d'une fenêtre et l'orbe, au-delà de la zone d'exclusion. */
const IDEAL_RING_DISTANCE = 90;
const CROWDING_RADIUS = 380;

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function inflate(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function nearestPointOnRect(rect: Rect, px: number, py: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(px, rect.x), rect.x + rect.width),
    y: Math.min(Math.max(py, rect.y), rect.y + rect.height),
  };
}

export function circleIntersectsRect(circle: Circle, rect: Rect): boolean {
  const nearest = nearestPointOnRect(rect, circle.cx, circle.cy);
  return Math.hypot(nearest.x - circle.cx, nearest.y - circle.cy) < circle.radius;
}

export function usableBounds(viewport: Size, margin: number): Rect {
  return { x: margin, y: margin, width: viewport.width - margin * 2, height: viewport.height - margin * 2 };
}

/** Vérifie qu'un emplacement respecte marges, zones HUD, orbe et fenêtres existantes. */
export function isFreePlacement(rect: Rect, scene: PlacementScene, options: PlacementOptions): boolean {
  if (!contains(usableBounds(scene.viewport, options.margin), rect)) return false;
  if (scene.obstacles.some((zone) => intersects(inflate(zone, options.gap), rect))) return false;
  if (circleIntersectsRect({ ...scene.orb, radius: scene.orb.radius + options.gap }, rect)) return false;
  return !scene.occupied.some((window) => intersects(inflate(window, options.gap / 2), rect));
}

function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Score d'un emplacement libre (plus il est bas, mieux c'est) :
 * - rester à distance raisonnable de l'orbe, sur un anneau autour d'elle ;
 * - s'éloigner des fenêtres voisines pour ne pas toujours empiler au même endroit.
 */
function scorePlacement(rect: Rect, scene: PlacementScene): number {
  const nearest = nearestPointOnRect(rect, scene.orb.cx, scene.orb.cy);
  const distanceToOrb = Math.hypot(nearest.x - scene.orb.cx, nearest.y - scene.orb.cy);
  const ringDeviation = Math.abs(distanceToOrb - (scene.orb.radius + IDEAL_RING_DISTANCE));

  const center = centerOf(rect);
  const crowding = scene.occupied.reduce((penalty, window) => {
    const other = centerOf(window);
    const distance = Math.hypot(center.x - other.x, center.y - other.y);
    return penalty + Math.max(0, CROWDING_RADIUS - distance);
  }, 0);

  return ringDeviation + crowding * 0.5;
}

/**
 * Cherche le meilleur emplacement pour une fenêtre de taille souhaitée. Essaie d'abord la taille
 * complète, puis une taille réduite. Renvoie `no-space` si aucun emplacement libre n'existe.
 */
export function placeWindow(
  scene: PlacementScene,
  desired: Size,
  options: PlacementOptions = DEFAULT_PLACEMENT,
): PlacementOutcome {
  const bounds = usableBounds(scene.viewport, options.margin);
  const step = Math.max(16, Math.round(Math.min(scene.viewport.width, scene.viewport.height) / 30));

  for (const factor of SIZE_FACTORS) {
    const width = Math.min(bounds.width, Math.max(options.minSize.width, Math.round(desired.width * factor)));
    const height = Math.min(bounds.height, Math.max(options.minSize.height, Math.round(desired.height * factor)));

    let best: { rect: Rect; score: number } | undefined;
    for (let y = bounds.y; y + height <= bounds.y + bounds.height; y += step) {
      for (let x = bounds.x; x + width <= bounds.x + bounds.width; x += step) {
        const rect = { x, y, width, height };
        if (!isFreePlacement(rect, scene, options)) continue;
        const score = scorePlacement(rect, scene);
        if (!best || score < best.score) best = { rect, score };
      }
    }

    if (best) return { placed: true, rect: best.rect, shrunk: factor < 1 };
  }

  return { placed: false, reason: "no-space" };
}

/** Ramène un rectangle dans les limites utiles de l'écran, en le réduisant si nécessaire. */
export function fitIntoBounds(rect: Rect, viewport: Size, margin: number): Rect {
  const bounds = usableBounds(viewport, margin);
  const width = Math.min(rect.width, bounds.width);
  const height = Math.min(rect.height, bounds.height);
  return {
    x: Math.min(Math.max(rect.x, bounds.x), bounds.x + bounds.width - width),
    y: Math.min(Math.max(rect.y, bounds.y), bounds.y + bounds.height - height),
    width,
    height,
  };
}

/**
 * Taille demandée à la main (poignée de redimensionnement). Elle ne descend pas sous la taille minimale et ne déborde
 * pas des limites utiles de l'écran ; le coin haut gauche reste en place.
 */
export function resizeRect(rect: Rect, size: Size, viewport: Size, options: PlacementOptions): Rect {
  const bounds = usableBounds(viewport, options.margin);
  const width = Math.min(Math.max(size.width, options.minSize.width), bounds.width);
  const height = Math.min(Math.max(size.height, options.minSize.height), bounds.height);
  return fitIntoBounds({ x: rect.x, y: rect.y, width, height }, viewport, options.margin);
}

export interface PlacedRect {  id: string;
  rect: Rect;
}

export interface ReflowResult {
  placed: PlacedRect[];
  overflow: string[];
}

/**
 * Réorganise les fenêtres après un changement de taille d'écran. Les fenêtres dont la position
 * reste valide sont conservées ; les autres sont replacées. Celles qui ne trouvent plus de place
 * sont renvoyées dans `overflow`.
 * `windows` est classé par priorité décroissante.
 */
export function reflowWindows(
  scene: Omit<PlacementScene, "occupied">,
  windows: { id: string; rect: Rect; desired: Size }[],
  options: PlacementOptions = DEFAULT_PLACEMENT,
): ReflowResult {
  const placed: PlacedRect[] = [];
  const overflow: string[] = [];

  for (const window of windows) {
    const current = fitIntoBounds(window.rect, scene.viewport, options.margin);
    const occupied = placed.map((entry) => entry.rect);
    const context = { ...scene, occupied };

    if (isFreePlacement(current, context, options)) {
      placed.push({ id: window.id, rect: current });
      continue;
    }

    const outcome = placeWindow(context, window.desired, options);
    if (outcome.placed) placed.push({ id: window.id, rect: outcome.rect });
    else overflow.push(window.id);
  }

  return { placed, overflow };
}
