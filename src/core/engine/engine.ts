import { registerBuiltinCapabilities } from "../capabilities/builtin";
import { CapabilityError, toCapabilityError } from "../capabilities/errors";
import { CapabilityRegistry } from "../capabilities/registry";
import type { CapabilityContext, CapabilityInput, CapabilityResult, Permission, SourceRef } from "../capabilities/types";
import { APPS } from "../intent/dictionaries";
import { parseIntent, type Intent } from "../intent/parse";
import { createNativeAdapter, type NativeAdapter } from "../native";
import type { PresentedContent } from "../presentation/types";
import { type Task, TaskCancelledError, TaskManager } from "../tasks/taskManager";
import { hasMessage, translate, type Locale, type MessageKey } from "../../i18n/messages";

export type OrbState = "idle" | "listening" | "recognizing" | "thinking" | "executing" | "responding" | "error";

export type EngineEvent =
  | { type: "message"; role: "user" | "assistant"; text: string; tone: "info" | "error" }
  | { type: "orb"; state: OrbState }
  | { type: "present"; content: PresentedContent; source: SourceRef }
  | { type: "window-command"; command: "close-last" | "close-all" };

export interface EngineOptions {
  native?: NativeAdapter;
  locale: Locale;
  /** Permissions accordées par défaut : elles correspondent au niveau « automatique ». */
  grantedPermissions?: Permission[];
  /** Durée pendant laquelle l'orbe garde son état de réponse ou d'erreur. */
  responseHoldMs?: number;
}

const DEFAULT_GRANTED: Permission[] = ["system.read", "process.launch"];

/**
 * Core Engine : transforme une commande en intention, route l'intention vers une capacité,
 * suit la tâche réelle et publie des événements pour l'interface. Aucun code d'interface ici.
 */
export class Engine {
  readonly #native: NativeAdapter;
  readonly #registry: CapabilityRegistry;
  readonly #tasks: TaskManager;
  readonly #listeners = new Set<(event: EngineEvent) => void>();
  readonly #holdMs: number;
  #locale: Locale;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: EngineOptions) {
    this.#native = options.native ?? createNativeAdapter();
    this.#locale = options.locale;
    this.#holdMs = options.responseHoldMs ?? 2500;
    this.#registry = new CapabilityRegistry(options.grantedPermissions ?? DEFAULT_GRANTED);
    registerBuiltinCapabilities(this.#registry);
    this.#tasks = new TaskManager({ concurrency: 3, historySize: 30 });
  }

  get locale(): Locale {
    return this.#locale;
  }

  setLocale(locale: Locale): void {
    this.#locale = locale;
  }

  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeTasks(listener: (tasks: Task[]) => void): () => void {
    return this.#tasks.subscribe(listener);
  }

  tasksSnapshot(): Task[] {
    return this.#tasks.snapshot();
  }

  cancelTask(id: string): boolean {
    return this.#tasks.cancel(id);
  }

  listCapabilities() {
    return this.#registry.list();
  }

  /** Ajoute une réponse de l'assistant, par exemple après une action de fenêtre décidée par l'interface. */
  say(text: string, tone: "info" | "error" = "info"): void {
    this.#emit({ type: "message", role: "assistant", text, tone });
    this.#setOrb(tone === "error" ? "error" : "responding");
    this.#scheduleIdle();
  }

  async submit(input: string): Promise<void> {
    const text = input.trim();
    if (!text) return;

    this.#emit({ type: "message", role: "user", text, tone: "info" });
    this.#setOrb("thinking");

    const { intent } = parseIntent(text);
    try {
      await this.#route(intent);
    } catch (error) {
      this.#fail(toCapabilityError(error));
    }
  }

  #t = (key: MessageKey, params?: Record<string, string | number>): string => translate(this.#locale, key, params);

  async #route(intent: Intent): Promise<void> {
    switch (intent.type) {
      case "OPEN_APPLICATION": {
        if (!intent.appId) {
          this.#fail(new CapabilityError("unknown-app", { name: intent.appName }));
          return;
        }
        const name = this.#t(APPS.find((app) => app.id === intent.appId)?.nameKey ?? "app.Notepad");
        return this.#runCapability("apps.launch", { appId: intent.appId }, { labelKey: "task.openApp", labelParams: { app: name } });
      }
      case "SYSTEM_INFO":
        return this.#runCapability("system.info", {}, { labelKey: "task.systemInfo" });
      case "CLOSE_WINDOW":
        this.#emit({ type: "window-command", command: "close-last" });
        return;
      case "CLOSE_ALL_WINDOWS":
        this.#emit({ type: "window-command", command: "close-all" });
        return;
      case "CANCEL_TASKS": {
        const count = this.#tasks.cancelAllCancellable();
        return this.say(count > 0 ? this.#t("cancel.done", { count }) : this.#t("cancel.none"));
      }
      case "HELP":
        return this.say(this.#t("intent.help"));
      case "UNKNOWN":
        return this.say(this.#t("intent.unknown", { text: intent.text }), "error");
    }
  }

  async #runCapability(
    capabilityId: string,
    input: CapabilityInput,
    task: { labelKey: MessageKey; labelParams?: Record<string, string>; cancellable?: boolean },
  ): Promise<void> {
    const { done } = this.#tasks.run(task, (signal) => this.#registry.invoke(capabilityId, input, this.#context(signal)));
    this.#setOrb("executing");

    let result: CapabilityResult;
    try {
      result = await done;
    } catch (error) {
      if (error instanceof TaskCancelledError) {
        this.say(this.#t("error.code.cancelled"));
        return;
      }
      this.#fail(toCapabilityError(error));
      return;
    }

    for (const content of result.presentations) {
      this.#emit({ type: "present", content, source: result.source });
    }
    this.say(result.caption);
  }

  #context(signal: AbortSignal): CapabilityContext {
    return { signal, native: this.#native, locale: this.#locale, t: this.#t };
  }

  #fail(error: CapabilityError): void {
    const text = this.#errorText(error);
    this.#emit({ type: "message", role: "assistant", text, tone: "error" });
    this.#emit({
      type: "present",
      content: { kind: "error-card", title: this.#t("error.title"), code: error.code, message: text },
      source: { capabilityId: "engine", locality: "local", collectedAt: Date.now() },
    });
    this.#setOrb("error");
    this.#scheduleIdle();
  }

  #errorText(error: CapabilityError): string {
    const key = `error.code.${error.code}`;
    const messageKey = hasMessage(key) ? key : "error.code.plugin-failure";
    return this.#t(messageKey, error.params);
  }

  #setOrb(state: OrbState): void {
    clearTimeout(this.#idleTimer);
    this.#emit({ type: "orb", state });
  }

  #scheduleIdle(): void {
    clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => this.#emit({ type: "orb", state: "idle" }), this.#holdMs);
  }

  #emit(event: EngineEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

export function createEngine(options: EngineOptions): Engine {
  return new Engine(options);
}
