import { useRef, type PointerEvent } from "react";

import type { OpenWindow } from "../core/presentation/windows";
import type { Rect, Size } from "../core/presentation/types";
import type { MessageKey } from "../i18n/messages";
import { PresentedContentView } from "./PresentedContentView";
import type { ReadFile } from "./viewers/FileView";

interface FloatingWindowProps {
  item: OpenWindow;
  zIndex: number;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  /** Lecture d'un fichier pour la visionneuse. */
  readFile?: ReadFile;
  onMove: (id: string, rect: Rect) => void;
  onResize: (id: string, size: Size) => void;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origin: Rect;
}

interface ResizeState {
  pointerId: number;
  startX: number;
  startY: number;
  origin: Size;
}

export function FloatingWindow({ item, zIndex, t, readFile, onMove, onResize, onFocus, onClose }: FloatingWindowProps) {
  const drag = useRef<DragState | null>(null);
  const resize = useRef<ResizeState | null>(null);
  const { rect } = item;

  // La poignée du coin redimensionne la fenêtre ; la taille minimale et les limites de l'écran sont appliquées par le moteur.
  const startResize = (event: PointerEvent<HTMLElement>) => {
    resize.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: { width: rect.width, height: rect.height },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  };

  const moveResize = (event: PointerEvent<HTMLElement>) => {
    const current = resize.current;
    if (!current || current.pointerId !== event.pointerId) return;
    onResize(item.id, {
      width: current.origin.width + event.clientX - current.startX,
      height: current.origin.height + event.clientY - current.startY,
    });
  };

  const endResize = (event: PointerEvent<HTMLElement>) => {
    if (resize.current?.pointerId === event.pointerId) resize.current = null;
  };

  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: rect };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    onMove(item.id, {
      ...current.origin,
      x: current.origin.x + event.clientX - current.startX,
      y: current.origin.y + event.clientY - current.startY,
    });
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  return (
    <section
      className="float-window"
      aria-label={item.content.title}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex }}
      onPointerDown={() => onFocus(item.id)}
    >
      <header
        title={t("ui.dragHint")}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span>{item.content.title}</span>
        <button type="button" className="icon-button" onClick={() => onClose(item.id)} aria-label={t("ui.close")}>
          ×
        </button>
      </header>
      <div className="body">
        <PresentedContentView content={item.content} readFile={readFile} t={t} />
      </div>
      <span
        className="resize-grip"
        title={t("ui.resize")}
        aria-label={t("ui.resize")}
        role="img"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      />
    </section>
  );
}
