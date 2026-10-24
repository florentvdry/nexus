// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScheduledTask } from "../core/schedule/controller";
import { translate } from "../i18n/messages";
import { SchedulePanel, type ScheduleSource } from "./SchedulePanel";

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate("fr", key, params);

const TASKS: ScheduledTask[] = [
  { id: 1, request: "résume mes actus", recurrence: { kind: "daily", time: "08:00" }, nextRunAt: new Date(2026, 9, 28, 8, 0).getTime(), createdAt: 0 },
  { id: 2, request: "rappelle Anthony", recurrence: { kind: "once", at: new Date(2026, 9, 29, 9, 0).getTime() }, nextRunAt: new Date(2026, 9, 29, 9, 0).getTime(), createdAt: 0 },
];

afterEach(cleanup);

describe("panneau Planning", () => {
  it("liste les tâches avec un bouton Annuler pour chacune", async () => {
    const source: ScheduleSource = { scheduledTasks: vi.fn(async () => TASKS), cancelScheduledTask: vi.fn(async () => {}) };
    render(<SchedulePanel source={source} locale="fr" t={t} onClose={() => {}} />);
    expect(await screen.findByText("résume mes actus")).toBeTruthy();
    expect(screen.getByText("rappelle Anthony")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Annuler « résume mes actus »" })).toBeTruthy();
  });

  it("annule une tâche et la retire de la liste", async () => {
    const source: ScheduleSource = { scheduledTasks: vi.fn(async () => TASKS), cancelScheduledTask: vi.fn(async () => {}) };
    render(<SchedulePanel source={source} locale="fr" t={t} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Annuler « rappelle Anthony »" }));
    await waitFor(() => expect(screen.queryByText("rappelle Anthony")).toBeNull());
    expect(source.cancelScheduledTask).toHaveBeenCalledWith(2);
    expect(screen.getByText("résume mes actus")).toBeTruthy();
  });

  it("sans tâche, le dit ; si la lecture échoue, l'affiche", async () => {
    const empty: ScheduleSource = { scheduledTasks: vi.fn(async () => []), cancelScheduledTask: vi.fn(async () => {}) };
    const { unmount } = render(<SchedulePanel source={empty} locale="fr" t={t} onClose={() => {}} />);
    expect(await screen.findByText("Aucune tâche programmée.")).toBeTruthy();
    unmount();

    const broken: ScheduleSource = {
      scheduledTasks: vi.fn(async () => {
        throw new Error("illisible");
      }),
      cancelScheduledTask: vi.fn(async () => {}),
    };
    render(<SchedulePanel source={broken} locale="fr" t={t} onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
