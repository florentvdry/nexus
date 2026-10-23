import { CapabilityError, toCapabilityError } from "../capabilities/errors";
import { CapabilityRegistry } from "../capabilities/registry";
import type { CapabilityContext, CapabilityInput, CapabilityResult, Permission, SourceRef } from "../capabilities/types";
import { registeredApplications, registerApplications, registerLanguageDictionary } from "../intent/registry";
import { loadBuiltinPlugins } from "../plugins/builtin";
import type { PluginStatus } from "../plugins/types";
import { parseIntent, type Intent } from "../intent/parse";
import { createNativeAdapter, type NativeAdapter } from "../native";
import { createOsintRunner } from "../osint/runner";
import type { OsintRunner } from "../osint/types";
import type { PresentedContent } from "../presentation/types";
import { type Task, TaskCancelledError, TaskManager } from "../tasks/taskManager";
import { hasMessage, translate, type Locale, type MessageKey } from "../../i18n/messages";

export type OrbState = "idle" | "listening" | "recognizing" | "thinking" | "executing" | "responding" | "error";

export type EngineEvent =
  | { type: "message"; role: "user" | "assistant"; text: string; tone: "info" | "error"; locale: Locale }
  | { type: "orb"; state: OrbState }
  | { type: "present"; content: PresentedContent; source: SourceRef }
  | { type: "window-command"; command: "close-last" | "close-all" };

export interface EngineOptions {
  native?: NativeAdapter;
  osint?: OsintRunner;
  locale: Locale;
  /** Permissions accordées par défaut : elles correspondent au niveau « automatique ». */
  grantedPermissions?: Permission[];
  /** Durée pendant laquelle l'orbe garde son état de réponse ou d'erreur. */
  responseHoldMs?: number;
}

export interface SubmitOptions {
  /** Langue de la réponse pour cette commande. Par défaut, la langue de l'interface. */
  locale?: Locale;
}

/** Langue et traducteur utilisés pour une réponse. */
interface Reply {
  locale: Locale;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const DEFAULT_GRANTED: Permission[] = ["system.read", "process.launch", "osint.passive", "file.read"];

function replyFor(locale: Locale): Reply {
  return { locale, t: (key, params) => translate(locale, key, params) };
}

/**
 * Core Engine : transforme une commande en intention, route l'intention vers une capacité,
 * suit la tâche réelle et publie des événements pour l'interface. Aucun code d'interface ici.
 */
export class Engine {
  readonly #native: NativeAdapter;
  readonly #osint: OsintRunner;
  readonly #plugins: PluginStatus[];
  readonly #registry: CapabilityRegistry;
  readonly #tasks: TaskManager;
  readonly #listeners = new Set<(event: EngineEvent) => void>();
  readonly #holdMs: number;
  #locale: Locale;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: EngineOptions) {
    this.#native = options.native ?? createNativeAdapter();
    this.#osint = options.osint ?? createOsintRunner();
    this.#locale = options.locale;
    this.#holdMs = options.responseHoldMs ?? 2500;
    this.#registry = new CapabilityRegistry(options.grantedPermissions ?? DEFAULT_GRANTED);
    this.#plugins = loadBuiltinPlugins({
      registerCapability: (manifest, handler) => this.#registry.register(manifest, handler),
      registerLanguage: (locale, dictionary) => registerLanguageDictionary(locale, dictionary),
      registerApplications: (entries) => registerApplications(entries),
    });
    this.#tasks = new TaskManager({ concurrency: 3, historySize: 30 });
  }

  /** État de chaque plugin chargé : un plugin en échec est signalé, il ne bloque pas les autres. */
  get plugins(): readonly PluginStatus[] {
    return this.#plugins;
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

  /** Ajoute une réponse de l'assistant, par exemple après une action décidée par l'interface. */
  say(text: string, tone: "info" | "error" = "info"): void {
    this.#reply(replyFor(this.#locale), text, tone);
  }

  /** Exécute une commande texte ou vocale et publie la réponse dans la langue demandée. */
  async submit(input: string, options: SubmitOptions = {}): Promise<void> {
    const text = input.trim();
    if (!text) return;

    const reply = replyFor(options.locale ?? this.#locale);
    this.#emit({ type: "message", role: "user", text, tone: "info", locale: reply.locale });
    this.#setOrb("thinking");

    const { intent } = parseIntent(text);
    try {
      await this.#route(intent, reply);
    } catch (error) {
      this.#fail(toCapabilityError(error), reply);
    }
  }

  async #route(intent: Intent, reply: Reply): Promise<void> {
    switch (intent.type) {
      case "OPEN_APPLICATION": {
        if (!intent.appId) {
          this.#fail(new CapabilityError("unknown-app", { name: intent.appName }), reply);
          return;
        }
        const entry = registeredApplications().find((app) => app.id === intent.appId);
        const name = reply.t(entry?.nameKey ?? "app.Notepad");
        return this.#runCapability("apps.launch", { appId: intent.appId }, { labelKey: "task.openApp", labelParams: { app: name } }, reply);
      }
      case "SYSTEM_INFO":
        return this.#runCapability("system.info", {}, { labelKey: "task.systemInfo" }, reply);
      case "OSINT_DOMAIN":
        return this.#runCapability("osint.domain", { domain: intent.domain }, { labelKey: "task.osintDomain", labelParams: { domain: intent.domain } }, reply);
      case "OSINT_USERNAME":
        return this.#runCapability("osint.username", { username: intent.username }, { labelKey: "task.osintUsername", labelParams: { username: intent.username } }, reply);
      case "DOCUMENT_INSPECT":
        return this.#runCapability("document.inspect", { path: intent.path }, { labelKey: "task.inspectFile", labelParams: { file: intent.path.split(/[\\/]/).pop() ?? intent.path } }, reply);
      case "UNSUPPORTED":
        return this.#reply(reply, reply.t(intent.reason === "email" ? "intent.emailUnsupported" : "intent.unknown", { text: intent.text }), "error");
      case "CLOSE_WINDOW":
        this.#emit({ type: "window-command", command: "close-last" });
        return;
      case "CLOSE_ALL_WINDOWS":
        this.#emit({ type: "window-command", command: "close-all" });
        return;
      case "CANCEL_TASKS": {
        const count = this.#tasks.cancelAllCancellable();
        return this.#reply(reply, count > 0 ? reply.t("cancel.done", { count }) : reply.t("cancel.none"));
      }
      case "HELP":
        return this.#reply(reply, reply.t("intent.help"));
      case "UNKNOWN":
        return this.#reply(reply, reply.t("intent.unknown", { text: intent.text }), "error");
    }
  }

  async #runCapability(
    capabilityId: string,
    input: CapabilityInput,
    task: { labelKey: MessageKey; labelParams?: Record<string, string>; cancellable?: boolean },
    reply: Reply,
  ): Promise<void> {
    const { done } = this.#tasks.run(task, (signal) => this.#registry.invoke(capabilityId, input, this.#context(signal, reply)));
    this.#setOrb("executing");

    let result: CapabilityResult;
    try {
      result = await done;
    } catch (error) {
      if (error instanceof TaskCancelledError) {
        this.#reply(reply, reply.t("error.code.cancelled"));
        return;
      }
      this.#fail(toCapabilityError(error), reply);
      return;
    }

    for (const content of result.presentations) {
      this.#emit({ type: "present", content, source: result.source });
    }
    this.#reply(reply, result.caption);
  }

  #context(signal: AbortSignal, reply: Reply): CapabilityContext {
    return { signal, native: this.#native, osint: this.#osint, locale: reply.locale, t: reply.t };
  }

  #fail(error: CapabilityError, reply: Reply): void {
    const text = this.#errorText(error, reply);
    this.#emit({ type: "message", role: "assistant", text, tone: "error", locale: reply.locale });
    this.#emit({
      type: "present",
      content: { kind: "error-card", title: reply.t("error.title"), code: error.code, message: text },
      source: { capabilityId: "engine", locality: "local", collectedAt: Date.now() },
    });
    this.#setOrb("error");
    this.#scheduleIdle();
  }

  #errorText(error: CapabilityError, reply: Reply): string {
    const key = `error.code.${error.code}`;
    const messageKey = hasMessage(key) ? key : "error.code.plugin-failure";
    return reply.t(messageKey, error.params);
  }

  #reply(reply: Reply, text: string, tone: "info" | "error" = "info"): void {
    this.#emit({ type: "message", role: "assistant", text, tone, locale: reply.locale });
    this.#setOrb(tone === "error" ? "error" : "responding");
    this.#scheduleIdle();
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
