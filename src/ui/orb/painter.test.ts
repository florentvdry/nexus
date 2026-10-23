import { describe, expect, it, vi } from "vitest";

import type { OrbState } from "../../core/engine/engine";
import { ORB_PROFILES, drawOrb } from "./painter";

const STATES: OrbState[] = ["idle", "listening", "recognizing", "thinking", "executing", "responding", "error"];

type FakeContext = ReturnType<typeof fakeContext>;

function fakeContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    createRadialGradient: vi.fn((..._args: number[]) => gradient),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "butt",
  };
}

const asCanvas = (ctx: FakeContext) => ctx as unknown as CanvasRenderingContext2D;

describe("orbe", () => {
  it("définit une animation distincte pour chacun des sept états", () => {
    expect(Object.keys(ORB_PROFILES).sort()).toEqual([...STATES].sort());
    const signatures = STATES.map((state) => JSON.stringify(ORB_PROFILES[state]));
    expect(new Set(signatures).size).toBe(STATES.length);
  });

  it("réfléchir tourne plus vite que rester inactif", () => {
    expect(ORB_PROFILES.thinking.ringSpeed).toBeGreaterThan(ORB_PROFILES.idle.ringSpeed);
  });

  it.each(STATES)("dessine l'état %s sans erreur", (state) => {
    const ctx = fakeContext();
    drawOrb(asCanvas(ctx), 1.25, state, 480, 480);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 480, 480);
    expect(ctx.arc).toHaveBeenCalled();
  });

  it("supprime le tremblement d'erreur quand la réduction des mouvements est active", () => {
    const moving = fakeContext();
    const still = fakeContext();
    drawOrb(asCanvas(moving), 0.37, "error", 400, 400);
    drawOrb(asCanvas(still), 0.37, "error", 400, 400, { reduceMotion: true });
    const haloCentre = (ctx: FakeContext) => ctx.createRadialGradient.mock.calls[0]?.[0];
    expect(haloCentre(moving)).not.toBe(haloCentre(still));
  });
});
