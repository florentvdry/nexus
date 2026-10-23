import { useEffect, useRef } from "react";

import type { OrbState } from "../core/engine/engine";
import { drawOrb } from "./orb/painter";

const REDUCED_MOTION_SCALE = 0.35;

export function Orb({ state }: { state: OrbState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let width = 0;
    let height = 0;

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = box.width;
      height = box.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const origin = performance.now();
    let frame = 0;
    const loop = (now: number) => {
      if (!document.hidden) {
        drawOrb(ctx, (now - origin) / 1000, stateRef.current, width, height, {
          motionScale: reduceMotion ? REDUCED_MOTION_SCALE : 1,
          reduceMotion,
        });
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    observer?.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="orb" data-orb>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
