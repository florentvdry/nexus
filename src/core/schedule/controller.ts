import type { MessageKey } from "../../i18n/messages";
import { describeRecurrence, nextRunAfter, type Recurrence } from "./recurrence";

/**
 * Tâches programmées : « rappelle-moi demain à 9 h », « chaque lundi, résume mes actus ». NEXUS vérifie la liste
 * régulièrement (tant qu'il tourne) et relance la demande à l'heure prévue, par le même chemin que les demandes
 * tapées : les confirmations restent donc les mêmes. Une tâche planifiée ne peut pas en planifier d'autres.
 */

export interface ScheduledTask {
  id: number;
  request: string;
  recurrence: Recurrence;
  /** Prochaine exécution, en millisecondes depuis l'époque Unix. */
  nextRunAt: number;
  createdAt: number;
}

export interface ScheduleBridge {
  scheduleList(): Promise<ScheduledTask[]>;
  scheduleSave(tasks: ScheduledTask[]): Promise<void>;
}

export interface ScheduleControllerOptions {
  bridge: ScheduleBridge;
  say: (text: string, tone?: "info" | "error") => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  /** Relance une demande programmée, comme si l'utilisateur la tapait. */
  run: (request: string) => Promise<void>;
  now?: () => number;
}

const MAX_TASKS = 100;

export class ScheduleController {
  readonly #options: ScheduleControllerOptions;
  #tasks: ScheduledTask[] | undefined;
  #executing = false;

  constructor(options: ScheduleControllerOptions) {
    this.#options = options;
  }

  /** Vrai pendant qu'une tâche programmée s'exécute : elle ne peut alors rien planifier à son tour. */
  get executing(): boolean {
    return this.#executing;
  }

  async add(request: string, recurrence: Recurrence): Promise<void> {
    const now = this.#now();
    const nextRunAt = nextRunAfter(recurrence, now);
    if (nextRunAt === null) return this.#options.say(this.#options.t("schedule.past"), "error");
    try {
      const tasks = await this.#load();
      if (tasks.length >= MAX_TASKS) return this.#options.say(this.#options.t("schedule.full", { max: MAX_TASKS }), "error");
      const id = tasks.reduce((highest, task) => Math.max(highest, task.id), 0) + 1;
      tasks.push({ id, request, recurrence, nextRunAt, createdAt: now });
      await this.#options.bridge.scheduleSave(tasks);
      this.#options.say(this.#options.t("schedule.added", { request, when: describeRecurrence(recurrence) }));
    } catch (error) {
      this.#failed(error);
    }
  }

  async list(): Promise<void> {
    try {
      const tasks = await this.#load();
      if (tasks.length === 0) return this.#options.say(this.#options.t("schedule.none"));
      const lines = tasks.map((task) => `${task.id}) ${task.request} (${describeRecurrence(task.recurrence)})`).join(" · ");
      this.#options.say(this.#options.t("schedule.list", { list: lines }));
    } catch (error) {
      this.#failed(error);
    }
  }

  /** Annule les tâches dont la demande contient `query`. */
  async cancel(query: string): Promise<void> {
    try {
      const tasks = await this.#load();
      const needle = query.trim().toLowerCase();
      const kept = tasks.filter((task) => !task.request.toLowerCase().includes(needle));
      const removed = tasks.length - kept.length;
      if (removed === 0) return this.#options.say(this.#options.t("schedule.notFound", { query }));
      this.#tasks = kept;
      await this.#options.bridge.scheduleSave(kept);
      this.#options.say(this.#options.t("schedule.cancelled", { count: removed }));
    } catch (error) {
      this.#failed(error);
    }
  }

  /**
   * Lance les tâches échues, une à une. Une tâche ponctuelle disparaît après son exécution ; une tâche récurrente
   * prend sa prochaine date. Une tâche manquée (NEXUS fermé) s'exécute une seule fois à la réouverture.
   */
  async tick(): Promise<void> {
    if (this.#executing) return;
    let tasks: ScheduledTask[];
    try {
      tasks = await this.#load();
    } catch {
      return;
    }
    const now = this.#now();
    const due = tasks.filter((task) => task.nextRunAt <= now);
    if (due.length === 0) return;

    this.#executing = true;
    try {
      for (const task of due) {
        const next = nextRunAfter(task.recurrence, now);
        const current = tasks;
        this.#tasks = next === null ? current.filter((item) => item.id !== task.id) : current.map((item) => (item.id === task.id ? { ...item, nextRunAt: next } : item));
        tasks = this.#tasks;
        await this.#options.bridge.scheduleSave(tasks);
        this.#options.say(this.#options.t("schedule.running", { request: task.request }));
        await this.#options.run(task.request);
      }
    } finally {
      this.#executing = false;
    }
  }

  async #load(): Promise<ScheduledTask[]> {
    if (this.#tasks === undefined) this.#tasks = await this.#options.bridge.scheduleList();
    return this.#tasks;
  }

  #now(): number {
    return this.#options.now ? this.#options.now() : Date.now();
  }

  #failed(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.#options.say(this.#options.t("schedule.failed", { message }), "error");
  }
}
