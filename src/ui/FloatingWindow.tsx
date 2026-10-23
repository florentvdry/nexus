import { useRef, type PointerEvent } from "react";

import type { OpenWindow } from "../core/presentation/windows";
import type { Rect } from "../core/presentation/types";
import type { MessageKey } from "../i18n/messages";
import { PresentedContentView } from "./PresentedContentView";

interface FloatingWindowProps {
  item: OpenWindow;
  zIndex: number;
  t: (key: MessageKey) => string;
  onMove: (id: string, rect: Rect) => void;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origin: Rect;
}

export function FloatingWindow({ item, zIndex, t, onMove, onFocus, onClose }: FloatingWindowProps) {
  const drag = useRef<DragState | null>(null);
  const { rect } = item;

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
        <PresentedContentView content={item.content} />
      </div>
    </section>
  );
}
