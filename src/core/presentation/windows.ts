import type { SourceRef } from "../capabilities/types";
import { type PlacementOptions, DEFAULT_PLACEMENT, type PlacementScene, fitIntoBounds, placeWindow, reflowWindows } from "./placement";
import { estimateSize } from "./sizing";
import type { PresentedContent, Rect } from "./types";

export const HISTORY_LIMIT = 20;

export type WindowRequest = { id: string; content: PresentedContent; source: SourceRef };

export interface OpenWindow extends WindowRequest {
  rect: Rect;
  desired: { width: number; height: number };
}

export type HistoryReason = "closed" | "evicted" | "no-space";

export interface HistoryEntry extends WindowRequest {
  reason: HistoryReason;
  closedAt: number;
}

/** État des fenêtres. `open` est ordonné du plus ancien au plus récent (le dernier est au premier plan). */
export interface WindowsState {
  open: OpenWindow[];
  history: HistoryEntry[];
}

export const EMPTY_WINDOWS: WindowsState = { open: [], history: [] };

export interface WindowContext {
  scene: Omit<PlacementScene, "occupied">;
  options?: PlacementOptions;
  now: number;
}

function toHistory(window: OpenWindow, reason: HistoryReason, now: number): HistoryEntry {
  return { id: window.id, content: window.content, source: window.source, reason, closedAt: now };
}

/**
 * Deux contenus identiques forment la même fenêtre. Une confirmation reste propre à sa demande (son identifiant),
 * elle n'est jamais fusionnée.
 */
export function isSameWindow(a: PresentedContent, b: PresentedContent): boolean {
  if (a.kind === "confirmation" || b.kind === "confirmation") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Ouvre une fenêtre à un emplacement libre. Si l'écran est saturé, la plus ancienne fenêtre est
 * déplacée dans l'historique pour laisser la place au résultat le plus récent. Si la même fenêtre est déjà
 * ouverte, elle passe au premier plan au lieu d'être ouverte une seconde fois.
 */
export function openWindow(state: WindowsState, request: WindowRequest, context: WindowContext): WindowsState {
  const existing = state.open.find((window) => isSameWindow(window.content, request.content));
  if (existing) return focusWindow(state, existing.id);

  const options = context.options ?? DEFAULT_PLACEMENT;
  const desired = estimateSize(request.content);
  let open = [...state.open];
  let history = state.history;

  for (;;) {
    const outcome = placeWindow({ ...context.scene, occupied: open.map((window) => window.rect) }, desired, options);
    if (outcome.placed) {
      const window: OpenWindow = { ...request, rect: outcome.rect, desired };
      return {
        open: [...open, window],
        history: history.filter((entry) => entry.id !== request.id),
      };
    }

    const oldest = open[0];
    if (!oldest) {
      const entry: HistoryEntry = { id: request.id, content: request.content, source: request.source, reason: "no-space", closedAt: context.now };
      return { open, history: [entry, ...history].slice(0, HISTORY_LIMIT) };
    }
    open = open.slice(1);
    history = [toHistory(oldest, "evicted", context.now), ...history].slice(0, HISTORY_LIMIT);
  }
}

export function closeWindow(state: WindowsState, id: string, now: number): WindowsState {
  const window = state.open.find((entry) => entry.id === id);
  if (!window) return state;
  return {
    open: state.open.filter((entry) => entry.id !== id),
    history: [toHistory(window, "closed", now), ...state.history].slice(0, HISTORY_LIMIT),
  };
}

export function closeLastWindow(state: WindowsState, now: number): WindowsState {
  const last = state.open[state.open.length - 1];
  return last ? closeWindow(state, last.id, now) : state;
}

export function closeAllWindows(state: WindowsState, now: number): WindowsState {
  return state.open.reduceRight((current, window) => closeWindow(current, window.id, now), state);
}

/** Place la fenêtre au premier plan et la déplace dans les limites de l'écran. */
export function moveWindow(state: WindowsState, id: string, rect: Rect, context: WindowContext): WindowsState {
  const window = state.open.find((entry) => entry.id === id);
  if (!window) return state;
  const fitted = fitIntoBounds(rect, context.scene.viewport, (context.options ?? DEFAULT_PLACEMENT).margin);
  const moved = { ...window, rect: fitted };
  return { ...state, open: [...state.open.filter((entry) => entry.id !== id), moved] };
}

export function focusWindow(state: WindowsState, id: string): WindowsState {
  const window = state.open.find((entry) => entry.id === id);
  if (!window || state.open[state.open.length - 1] === window) return state;
  return { ...state, open: [...state.open.filter((entry) => entry.id !== id), window] };
}

export function reopenFromHistory(state: WindowsState, id: string, context: WindowContext): WindowsState {
  const entry = state.history.find((item) => item.id === id);
  if (!entry) return state;
  const withoutEntry = { ...state, history: state.history.filter((item) => item.id !== id) };
  return openWindow(withoutEntry, { id: entry.id, content: entry.content, source: entry.source }, context);
}

/** Réorganise les fenêtres ouvertes après un changement de taille d'écran. */
export function reflowOpenWindows(state: WindowsState, context: WindowContext): WindowsState {
  const options = context.options ?? DEFAULT_PLACEMENT;
  const newestFirst = [...state.open].reverse();
  const result = reflowWindows(
    context.scene,
    newestFirst.map((window) => ({ id: window.id, rect: window.rect, desired: window.desired })),
    options,
  );

  const placedById = new Map(result.placed.map((entry) => [entry.id, entry.rect]));
  const open = state.open
    .filter((window) => placedById.has(window.id))
    .map((window) => ({ ...window, rect: placedById.get(window.id) ?? window.rect }));

  const evicted = state.open.filter((window) => result.overflow.includes(window.id));
  const history = evicted.reduce(
    (items, window) => [toHistory(window, "no-space", context.now), ...items],
    state.history,
  ).slice(0, HISTORY_LIMIT);

  return { open, history };
}

/**
 * Fenêtre que Échap ferme : la dernière ouverte, sauf une demande de confirmation. Une confirmation attend une réponse
 * explicite (approuver ou refuser) : la touche Échap ne doit jamais décider à sa place.
 */
export function escapeTarget(state: WindowsState): OpenWindow | undefined {
  const last = state.open.at(-1);
  return last && last.content.kind !== "confirmation" ? last : undefined;
}
