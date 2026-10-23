import type { MessageKey } from "../../i18n/messages";

export type TaskState = "pending" | "running" | "done" | "error" | "cancelled";

export interface Task {
  id: string;
  labelKey: MessageKey;
  labelParams: Record<string, string>;
  state: TaskState;
  cancellable: boolean;
  createdAt: number;
  updatedAt: number;
  errorCode?: string;
}

export interface TaskOptions {
  labelKey: MessageKey;
  labelParams?: Record<string, string>;
  cancellable?: boolean;
}

export class TaskCancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "TaskCancelledError";
  }
}

interface Entry {
  task: Task;
  controller: AbortController;
  settled: boolean;
  start: () => void;
  fail: (error: unknown) => void;
}

export interface TaskManagerOptions {
  concurrency: number;
  historySize: number;
  now?: () => number;
}

/**
 * Suit les tâches réelles. Un état n'est publié que lorsqu'il correspond à une action effective :
 * `pending` tant que la file est saturée, `running` pendant l'exécution du travail, puis un état final.
 */
export class TaskManager {
  readonly #entries: Entry[] = [];
  #queue: Entry[] = [];
  #active = 0;
  #sequence = 0;
  readonly #listeners = new Set<(tasks: Task[]) => void>();
  readonly #options: TaskManagerOptions;

  constructor(options: TaskManagerOptions) {
    this.#options = options;
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  snapshot(): Task[] {
    return this.#entries.map((entry) => ({ ...entry.task, labelParams: { ...entry.task.labelParams } }));
  }

  subscribe(listener: (tasks: Task[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    const tasks = this.snapshot();
    for (const listener of this.#listeners) listener(tasks);
  }

  run<T>(options: TaskOptions, work: (signal: AbortSignal) => Promise<T>): { id: string; done: Promise<T> } {
    this.#sequence += 1;
    const now = this.#now();
    const entry: Entry = {
      task: {
        id: `task-${this.#sequence}`,
        labelKey: options.labelKey,
        labelParams: options.labelParams ?? {},
        state: "pending",
        cancellable: options.cancellable ?? true,
        createdAt: now,
        updatedAt: now,
      },
      controller: new AbortController(),
      settled: false,
      start: () => {},
      fail: () => {},
    };

    const done = new Promise<T>((resolve, reject) => {
      entry.fail = reject;
      entry.start = () => {
        this.#transition(entry, "running");
        this.#active += 1;
        new Promise<T>((run) => run(work(entry.controller.signal)))
          .then(
            (value) => {
              if (this.#settle(entry, "done")) resolve(value);
            },
            (error: unknown) => {
              const state = entry.controller.signal.aborted ? "cancelled" : "error";
              if (this.#settle(entry, state, errorCodeOf(error))) reject(error);
            },
          )
          .finally(() => {
            this.#active -= 1;
            this.#drain();
          });
      };
    });

    this.#entries.push(entry);
    this.#queue.push(entry);
    this.#trim();
    this.#emit();
    this.#drain();
    return { id: entry.task.id, done };
  }

  /** Annule une tâche non terminée. Renvoie `false` si elle est déjà terminée ou non annulable. */
  cancel(id: string): boolean {
    const entry = this.#entries.find((item) => item.task.id === id);
    if (!entry || entry.settled || !entry.task.cancellable) return false;

    this.#queue = this.#queue.filter((queued) => queued !== entry);
    if (!this.#settle(entry, "cancelled")) return false;
    entry.controller.abort();
    entry.fail(new TaskCancelledError());
    this.#drain();
    return true;
  }

  /** Annule toutes les tâches annulables en cours. Renvoie leur nombre. */
  cancelAllCancellable(): number {
    const ids = this.#entries
      .filter((entry) => !entry.settled && entry.task.cancellable)
      .map((entry) => entry.task.id);
    return ids.filter((id) => this.cancel(id)).length;
  }

  #drain(): void {
    while (this.#active < this.#options.concurrency && this.#queue.length > 0) {
      const next = this.#queue.shift();
      next?.start();
    }
  }

  #transition(entry: Entry, state: TaskState): void {
    entry.task.state = state;
    entry.task.updatedAt = this.#now();
    this.#emit();
  }

  #settle(entry: Entry, state: TaskState, errorCode?: string): boolean {
    if (entry.settled) return false;
    entry.settled = true;
    entry.task.errorCode = errorCode;
    this.#transition(entry, state);
    return true;
  }

  #trim(): void {
    const settled = this.#entries.filter((entry) => entry.settled).length;
    let excess = this.#entries.length - this.#options.historySize;
    for (let index = 0; index < this.#entries.length && excess > 0 && settled > 0; ) {
      if (this.#entries[index].settled) {
        this.#entries.splice(index, 1);
        excess -= 1;
      } else {
        index += 1;
      }
    }
  }
}

function errorCodeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "task-failed";
}
