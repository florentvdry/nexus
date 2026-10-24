import { describe, expect, it, vi } from "vitest";

import { translate } from "../../i18n/messages";
import { validateModelIntent } from "../language-model/validate";
import { ScheduleController, type ScheduledTask, type ScheduleBridge } from "./controller";
import { nextRunAfter, parseTime } from "./recurrence";

// Mardi 27 octobre 2026, 10 h : les dates de ces tests partent de là.
const TUESDAY_10H = new Date(2026, 9, 27, 10, 0, 0, 0).getTime();

describe("heures et récurrences", () => {
  it("lit une heure HH:MM et refuse le reste", () => {
    expect(parseTime("09:30")).toEqual({ hours: 9, minutes: 30 });
    expect(parseTime("9:30")).toBeNull();
    expect(parseTime("25:00")).toBeNull();
  });

  it("une fois : la date passée n'a plus de prochaine exécution", () => {
    const later = new Date(2026, 9, 28, 9, 0).getTime();
    expect(nextRunAfter({ kind: "once", at: later }, TUESDAY_10H)).toBe(later);
    expect(nextRunAfter({ kind: "once", at: TUESDAY_10H - 1 }, TUESDAY_10H)).toBeNull();
  });

  it("chaque jour : aujourd'hui si l'heure n'est pas passée, demain sinon", () => {
    expect(nextRunAfter({ kind: "daily", time: "18:00" }, TUESDAY_10H)).toBe(new Date(2026, 9, 27, 18, 0).getTime());
    expect(nextRunAfter({ kind: "daily", time: "09:00" }, TUESDAY_10H)).toBe(new Date(2026, 9, 28, 9, 0).getTime());
  });

  it("chaque semaine : le prochain jour demandé (1 = lundi)", () => {
    expect(nextRunAfter({ kind: "weekly", weekday: 1, time: "09:00" }, TUESDAY_10H)).toBe(new Date(2026, 10, 2, 9, 0).getTime());
  });
});

describe("validation de la réponse du modèle", () => {
  it("accepte une tâche ponctuelle, quotidienne ou hebdomadaire", () => {
    expect(validateModelIntent({ type: "SCHEDULE", request: "résume mes actus", kind: "daily", time: "08:00" })).toEqual({
      type: "SCHEDULE",
      request: "résume mes actus",
      recurrence: { kind: "daily", time: "08:00" },
    });
    expect(validateModelIntent({ type: "SCHEDULE", request: "rappel", kind: "weekly", weekday: 1, time: "09:00" })).toMatchObject({
      recurrence: { kind: "weekly", weekday: 1 },
    });
    expect(validateModelIntent({ type: "SCHEDULE", request: "rappel", kind: "once", at: "2026-10-28T09:00" })).toMatchObject({
      recurrence: { kind: "once" },
    });
  });

  it("refuse une heure absurde, un jour hors de 0 à 6, ou une date illisible", () => {
    expect(validateModelIntent({ type: "SCHEDULE", request: "x", kind: "daily", time: "99:99" })).toBeNull();
    expect(validateModelIntent({ type: "SCHEDULE", request: "x", kind: "weekly", weekday: 7, time: "09:00" })).toBeNull();
    expect(validateModelIntent({ type: "SCHEDULE", request: "x", kind: "once", at: "bientôt" })).toBeNull();
    expect(validateModelIntent({ type: "SCHEDULE", kind: "daily", time: "09:00" })).toBeNull();
  });

  it("l'annulation et la liste passent par des intentions dédiées", () => {
    expect(validateModelIntent({ type: "CANCEL_SCHEDULE", query: "actus" })).toEqual({ type: "CANCEL_SCHEDULE", query: "actus" });
    expect(validateModelIntent({ type: "LIST_SCHEDULES" })).toEqual({ type: "LIST_SCHEDULES" });
  });
});

function fakeBridge(initial: ScheduledTask[] = []) {
  let stored = [...initial];
  const bridge: ScheduleBridge = {
    scheduleList: vi.fn(async () => [...stored]),
    scheduleSave: vi.fn(async (tasks: ScheduledTask[]) => {
      stored = [...tasks];
    }),
  };
  return { bridge, saved: () => stored };
}

function setup(bridge: ScheduleBridge, now: () => number, run = vi.fn(async () => {})) {
  const said: string[] = [];
  const controller = new ScheduleController({
    bridge,
    say: (text) => said.push(text),
    t: (key, params) => translate("fr", key, params),
    run,
    now,
  });
  return { controller, said, run };
}

describe("tâches programmées", () => {
  it("ajoute une tâche, la sauvegarde et annonce sa prochaine exécution", async () => {
    const { bridge, saved } = fakeBridge();
    const { controller, said } = setup(bridge, () => TUESDAY_10H);
    await controller.add("résume mes actus", { kind: "daily", time: "08:00" });
    expect(saved()).toHaveLength(1);
    expect(saved()[0].nextRunAt).toBe(new Date(2026, 9, 28, 8, 0).getTime());
    expect(said.at(-1)).toContain("résume mes actus");
  });

  it("refuse une tâche ponctuelle dans le passé, sans rien enregistrer", async () => {
    const { bridge, saved } = fakeBridge();
    const { controller, said } = setup(bridge, () => TUESDAY_10H);
    await controller.add("rappel", { kind: "once", at: TUESDAY_10H - 60_000 });
    expect(saved()).toHaveLength(0);
    expect(said.at(-1)).toContain("passée");
  });

  it("au moment prévu, relance la demande et garde la tâche récurrente", async () => {
    const eight = new Date(2026, 9, 28, 8, 0).getTime();
    const { bridge, saved } = fakeBridge([{ id: 1, request: "résume mes actus", recurrence: { kind: "daily", time: "08:00" }, nextRunAt: eight, createdAt: 0 }]);
    let clock = eight;
    const { controller, run } = setup(bridge, () => clock);
    await controller.tick();
    expect(run).toHaveBeenCalledWith("résume mes actus");
    expect(saved()[0].nextRunAt).toBe(new Date(2026, 9, 29, 8, 0).getTime());
    clock = eight + 1000;
    await controller.tick();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("une tâche ponctuelle disparaît après son exécution", async () => {
    const at = TUESDAY_10H + 60_000;
    const { bridge, saved } = fakeBridge([{ id: 7, request: "rappel", recurrence: { kind: "once", at }, nextRunAt: at, createdAt: 0 }]);
    const { controller } = setup(bridge, () => at);
    await controller.tick();
    expect(saved()).toHaveLength(0);
  });

  it("annule par mot-clé, et dit s'il n'y a rien à annuler", async () => {
    const { bridge, saved } = fakeBridge([
      { id: 1, request: "résume mes actus", recurrence: { kind: "daily", time: "08:00" }, nextRunAt: 1, createdAt: 0 },
      { id: 2, request: "rappelle Anthony", recurrence: { kind: "daily", time: "09:00" }, nextRunAt: 1, createdAt: 0 },
    ]);
    const { controller, said } = setup(bridge, () => TUESDAY_10H);
    await controller.cancel("ACTUS");
    expect(saved().map((task) => task.id)).toEqual([2]);
    await controller.cancel("inconnu");
    expect(said.at(-1)).toContain("ne correspond");
  });

  it("une tâche déjà en cours ne déclenche pas une autre tâche : pas de boucle", async () => {
    const { bridge } = fakeBridge([{ id: 1, request: "x", recurrence: { kind: "daily", time: "08:00" }, nextRunAt: 1, createdAt: 0 }]);
    let inner: boolean | undefined;
    const { controller } = setup(bridge, () => TUESDAY_10H, vi.fn(async () => {
      inner = controller.executing;
    }));
    await controller.tick();
    expect(inner).toBe(true);
    expect(controller.executing).toBe(false);
  });
});
