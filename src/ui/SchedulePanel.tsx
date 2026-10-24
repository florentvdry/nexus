import { useEffect, useState } from "react";

import type { ScheduledTask } from "../core/schedule/controller";
import { describeRecurrence } from "../core/schedule/recurrence";
import type { MessageKey } from "../i18n/messages";

/** Ce que le panneau lit et annule : l'engine le fournit. */
export interface ScheduleSource {
  scheduledTasks(): Promise<ScheduledTask[]>;
  cancelScheduledTask(id: number): Promise<void>;
}

interface SchedulePanelProps {
  source: ScheduleSource;
  locale: string;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  onClose: () => void;
}

/** Planning : toutes les tâches programmées, avec un bouton pour annuler chacune. Ouvert depuis la barre du haut. */
export function SchedulePanel({ source, locale, t, onClose }: SchedulePanelProps) {
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    source.scheduledTasks().then(
      (list) => active && setTasks(list),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [source]);

  const cancel = async (task: ScheduledTask) => {
    try {
      await source.cancelScheduledTask(task.id);
      setTasks((current) => current?.filter((item) => item.id !== task.id) ?? null);
    } catch {
      setFailed(true);
    }
  };

  return (
    <section className="schedule-panel" data-hud aria-label={t("schedule.open")}>
      <header>
        <h2>{t("schedule.windowTitle")}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("ui.close")}>
          ×
        </button>
      </header>

      {failed && (
        <p className="warn small" role="alert">
          {t("schedule.loadFailed")}
        </p>
      )}
      {tasks && tasks.length === 0 && <p className="muted small">{t("schedule.none")}</p>}

      {tasks && tasks.length > 0 && (
        <ul className="schedule-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <div>
                <strong>{task.request}</strong>
                <small className="muted">
                  {describeRecurrence(task.recurrence)} · {t("schedule.colNext")} {new Date(task.nextRunAt).toLocaleString(locale)}
                </small>
              </div>
              <button type="button" className="schedule-cancel" onClick={() => void cancel(task)} aria-label={t("schedule.cancelTask", { request: task.request })}>
                {t("schedule.cancel")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
