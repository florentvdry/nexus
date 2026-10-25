import type { MessageKey } from "../i18n/messages";
import type { Task, TaskState } from "../core/tasks/taskManager";

const STATUS_KEY: Record<TaskState, MessageKey> = {
  pending: "task.status.pending",
  running: "task.status.running",
  done: "task.status.done",
  error: "task.status.error",
  cancelled: "task.status.cancelled",
};

const ICON: Record<TaskState, string> = {
  pending: "○",
  running: "",
  done: "✓",
  error: "✕",
  cancelled: "–",
};

const VISIBLE_TASKS = 5;

interface TaskPanelProps {
  tasks: Task[];
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  onCancel: (id: string) => void;
}

export function TaskPanel({ tasks, t, onCancel }: TaskPanelProps) {
  const visible = tasks.slice(-VISIBLE_TASKS).reverse();

  return (
    <section className="aside-section" aria-label={t("ui.tasks")}>
      <h2>{t("ui.tasks")}</h2>
      {visible.length === 0 ? (
        <p className="muted">{t("ui.noTasks")}</p>
      ) : (
        <ul>
          {visible.map((task) => (
            <li key={task.id} className={`task-row task-${task.state}`}>
              <span className="task-icon" aria-hidden="true">
                {ICON[task.state]}
              </span>
              <span className="task-label">{t(task.labelKey, task.labelParams)}</span>
              <span className="sr-only">{t(STATUS_KEY[task.state])}</span>
              {task.state === "running" && task.cancellable && (
                <button type="button" className="icon-button" onClick={() => onCancel(task.id)} aria-label={t("ui.cancelTask")}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
