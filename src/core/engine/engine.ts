import { registerPacks } from "../plugins/packs";
import { Conversation, answerClarification } from "../conversation/conversation";
import type { Clarification } from "../conversation/types";
import { splitSteps } from "../intent/understand";
import { CapabilityError, toCapabilityError } from "../capabilities/errors";
import { CapabilityRegistry } from "../capabilities/registry";
import type { CapabilityContext, CapabilityInput, CapabilityResult, Permission, SourceRef } from "../capabilities/types";
import { registeredApplications, registerApplications, registerLanguageDictionary } from "../intent/registry";
import { loadBuiltinPlugins } from "../plugins/builtin";
import type { PluginStatus } from "../plugins/types";
import type { Intent } from "../intent/parse";
import type { Classifier } from "../language-model/benchmark";
import { understandWithModel } from "../language-model/branch";
import { nativeClassifier } from "../language-model/classifier";
import { readSelectedModel } from "../language-model/selection";
import { ConnectorFlow } from "../connectors/flow";
import { createNativeAdapter, type NativeAdapter } from "../native";
import { createOsintRunner } from "../osint/runner";
import { createNativeBridge, type AutoApproval, type ConfirmationRequest, type NativeBridge } from "../native/bridge";
import { RULE_ACTION } from "../native/rules";
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
  bridge?: NativeBridge;
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

// Les permissions « confirmation » sont accordées ici : elles autorisent seulement à demander l'action.
// Le natif (courtier de permissions) refuse l'exécution tant que l'utilisateur n'a pas répondu.
const DEFAULT_GRANTED: Permission[] = [
  "plugin.manage",
  "system.read",
  "process.launch",
  "osint.passive",
  "file.read",
  "file.write",
  "file.delete",
  "agent.run",
  "window.read",
  "window.control",
];

/** Titre affiché pour chaque permission demandant une confirmation. */
/** Salutations courantes, en français et en anglais. Une salutation reçoit une réponse aimable, jamais une erreur. */
const GREETING = /^(salut|bonjour|bonsoir|coucou|slt|bjr|hello|hi|hey|yo)\b/i;

const PERMISSION_TITLE: Record<string, MessageKey> = {
  "file.write": "confirm.title.fileWrite",
  "file.delete": "confirm.title.fileDelete",
  "agent.run": "confirm.title.agentRun",
  "window.control": "confirm.title.windowControl",
  "plugin.manage": "confirm.title.pluginManage",
};

/** Libellé de chaque ligne de détail d'une demande de confirmation. */
const ROW_LABEL: Record<string, MessageKey> = {
  from: "confirm.row.from",
  to: "confirm.row.to",
  path: "confirm.row.path",
  project: "confirm.row.project",
  prompt: "confirm.row.prompt",
  window: "confirm.row.window",
  process: "confirm.row.process",
  requester: "confirm.row.requester",
  plugin: "confirm.row.plugin",
  version: "confirm.row.version",
  commit: "confirm.row.commit",
  kinds: "confirm.row.kinds",
  digest: "confirm.row.digest",
  source: "confirm.row.source",
  permissions: "confirm.row.permissions",
  commands: "confirm.row.commands",
  previous: "confirm.row.previous",
};

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

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
  readonly #bridge: NativeBridge;
  readonly #conversation = new Conversation();
  readonly #unsubscribeConfirmations: () => void;
  readonly #unsubscribeAutoApprovals: () => void;
  /** Modèle local, interrogé seulement quand les règles ne comprennent pas (TODO §1). */
  readonly #classifier: Classifier;
  /** Connecteurs MCP : installation et appel d'un service extérieur, étape par étape, après accord de l'utilisateur. */
  readonly #connectors: ConnectorFlow;
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
    this.#bridge = options.bridge ?? createNativeBridge();
    this.#classifier = nativeClassifier(this.#bridge, readSelectedModel);
    this.#connectors = new ConnectorFlow({
      bridge: this.#bridge,
      model: () => readSelectedModel(),
      say: (text, tone) => this.#reply(replyFor(this.#locale), text, tone),
      t: (key, params) => translate(this.#locale, key, params),
    });
    this.#unsubscribeConfirmations = this.#bridge.onConfirmationRequest((request) => this.#presentConfirmation(request));
    this.#unsubscribeAutoApprovals = this.#bridge.onAutoApproval((approval) => this.#announceAutomatic(approval));
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

  /** Arrête l'écoute des événements natifs. */
  dispose(): void {
    this.#unsubscribeConfirmations();
    this.#unsubscribeAutoApprovals();
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
    // Les paquets sont revérifiés à chaque commande : un plugin modifié après approbation n'influence plus la compréhension.
    await this.refreshPacks();

    const reply = replyFor(options.locale ?? this.#locale);
    // La valeur d'une variable secrète (jeton) n'est jamais réaffichée dans la conversation.
    if (!this.#connectors.awaitsSecret) this.#emit({ type: "message", role: "user", text, tone: "info", locale: reply.locale });
    this.#setOrb("thinking");

    try {
      await this.#handle(text, reply);
    } catch (error) {
      this.#fail(toCapabilityError(error), reply);
    }
  }

  /**
   * Traite une saisie : répond d'abord à la question en attente, découpe les demandes successives, puis résout
   * les références (« le deuxième », « ferme-le ») avant la compréhension.
   */
  async #handle(text: string, reply: Reply): Promise<void> {
    // Une étape d'installation de connecteur en attente (oui/non, valeur, confirmation) reçoit la saisie d'abord.
    if (await this.#connectors.consume(text)) return;
    const pending = this.#conversation.pending();
    if (pending) {
      this.#conversation.clearPending();
      const answer = answerClarification(pending, text);
      if (answer === "cancel") return this.#reply(reply, reply.t("clarify.cancelled"));
      if (answer) return this.#handle(answer.text, reply);
    }

    const steps = splitSteps(text);
    if (steps.length > 1) {
      for (const step of steps) {
        await this.#handle(step, reply);
        // Une étape qui pose une question suspend la suite : la réponse concerne d'abord cette question.
        if (this.#conversation.pending()) return;
      }
      return;
    }

    const resolution = this.#conversation.resolve(text);
    if (resolution.clarification) return this.#ask(resolution.clarification, reply);

    // Les règles d'abord ; le modèle local ne intervient que sur `UNKNOWN`, et sa réponse est validée avant usage.
    const { intent } = await understandWithModel(resolution.text, this.#classifier);
    this.#journal(text, intent.type);
    await this.#route(intent, reply);
  }

  /** Pose une question : la réponse de l'utilisateur sera interprétée par `#handle`. */
  #ask(clarification: Clarification, reply: Reply): void {
    this.#conversation.ask(clarification);
    const choices = clarification.options.map((option, index) => `${index + 1}) ${option.label}`).join(" · ");
    this.#reply(reply, choices ? `${clarification.question} ${choices}` : clarification.question);
  }

  async #route(intent: Intent, reply: Reply): Promise<void> {
    switch (intent.type) {
      case "OPEN_APPLICATION": {
        if (!intent.appId && intent.suggestion) {
          // Un nom proche d'une application connue : on demande avant de lancer quoi que ce soit.
          const suggested = registeredApplications().find((app) => app.id === intent.suggestion?.appId);
          const name = reply.t(suggested?.nameKey ?? "app.Notepad");
          return this.#ask({ question: reply.t("clarify.didYouMean", { name }), options: [{ label: name, text: `lance ${intent.suggestion.alias}` }] }, reply);
        }
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
      case "FILE_SEARCH": {
        const input: CapabilityInput = {};
        if (intent.extension) input.extension = intent.extension;
        if (intent.folderHint) input.folderHint = intent.folderHint;
        if (intent.withinDays) input.withinDays = String(intent.withinDays);
        return this.#runCapability("files.search", input, { labelKey: "task.fileSearch" }, reply);
      }
      case "FILE_RENAME":
        return this.#runCapability("files.operate", { kind: "rename", from: intent.path, newName: intent.newName }, { labelKey: "task.fileOperation", labelParams: { file: basename(intent.path) } }, reply);
      case "FILE_MOVE":
        return this.#runCapability("files.operate", { kind: "move", from: intent.path, toDir: intent.toDir }, { labelKey: "task.fileOperation", labelParams: { file: basename(intent.path) } }, reply);
      case "FILE_TRASH":
        return this.#runCapability("files.operate", { kind: "trash", path: intent.path }, { labelKey: "task.fileOperation", labelParams: { file: basename(intent.path) } }, reply);
      case "PROCESS_LIST":
        return this.#runCapability("system.processes", { limit: "8" }, { labelKey: "task.processes" }, reply);
      case "PLUGIN_CATALOG":
        return this.#runCapability("plugin.catalog", {}, { labelKey: "task.pluginCatalog", cancellable: true }, reply);
      case "PLUGIN_LIST":
        return this.#runCapability("plugin.list", {}, { labelKey: "task.pluginList" }, reply);
      case "PLUGIN_INSTALL":
        return this.#runCapability("plugin.install", { target: intent.target }, { labelKey: "task.pluginInstall", labelParams: { target: intent.target }, cancellable: true }, reply);
      case "PLUGIN_ACTION":
        return this.#runCapability("plugin.run", { pluginId: intent.pluginId, command: intent.command, text: intent.text }, { labelKey: "task.pluginAction", labelParams: { command: intent.command }, cancellable: true }, reply);
      case "PLUGIN_REMOVE":
        return this.#runCapability("plugin.remove", { id: intent.id }, { labelKey: "task.pluginRemove", labelParams: { id: intent.id } }, reply);
      case "WINDOW_LIST":
        return this.#runCapability("window.list", {}, { labelKey: "task.windows" }, reply);
      case "WINDOW_FOCUS":
        return this.#runCapability("window.focus", { name: intent.name }, { labelKey: "task.windowFocus", labelParams: { name: intent.name } }, reply);
      case "WINDOW_CLOSE":
        return this.#runCapability("window.close", { name: intent.name }, { labelKey: "task.windowClose", labelParams: { name: intent.name } }, reply);
      case "AGENT_RUN":
        if (!intent.project || !intent.prompt) {
          return this.#reply(reply, reply.t("agent.needsProject"), "error");
        }
        return this.#runCapability("agent.claude-code", { project: intent.project, prompt: intent.prompt }, { labelKey: "task.agent", labelParams: {} }, reply);
      case "NEEDS_CONNECTOR":
        // Le modèle a reconnu un service extérieur : on cherche un connecteur de confiance et on propose de l'installer.
        return this.#connectors.start(intent.task, intent.service);
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
      case "CHAT":
        // La réponse du modèle, telle quelle : ce n'est pas une erreur.
        return this.#reply(reply, intent.text);
      case "UNKNOWN":
        // Sans modèle, une salutation reçoit tout de même une réponse aimable ; le reste est une vraie incompréhension.
        if (GREETING.test(intent.text.trim())) return this.#reply(reply, reply.t("greet.reply"));
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

    // Une réponse qui dépend d'un choix pose la question au lieu de conclure.
    if (result.clarification) {
      return this.#ask({ question: result.caption, options: result.clarification.options }, reply);
    }
    // Les éléments de cette réponse deviennent la référence de la suite ; une réponse sans liste l'efface.
    this.#conversation.setReferents(result.referents ?? []);
    for (const content of result.presentations) {
      this.#emit({ type: "present", content, source: result.source });
    }
    this.#reply(reply, result.caption);
    // Un plugin installé ou supprimé change les paquets actifs : la compréhension suit immédiatement.
    if (capabilityId === "plugin.install" || capabilityId === "plugin.remove") void this.refreshPacks();
  }

  /**
   * Recharge les paquets de données actifs. Sans magasin de plugins (navigateur, installation indisponible),
   * la compréhension reste celle des plugins intégrés.
   */
  async refreshPacks(): Promise<void> {
    try {
      registerPacks(await this.#bridge.pluginPacks());
    } catch {
      // Rien à charger : le moteur continue avec les plugins intégrés.
    }
  }

  #context(signal: AbortSignal, reply: Reply): CapabilityContext {
    return {
      signal,
      native: this.#native,
      osint: this.#osint,
      bridge: this.#bridge,
      locale: reply.locale,
      t: reply.t,
      progress: (text) => this.#emit({ type: "message", role: "assistant", text, tone: "info", locale: reply.locale }),
    };
  }

  /**
   * Le journal ne garde une commande que si l'utilisateur l'a activé : c'est le natif qui décide.
   * Une panne du journal ne doit jamais bloquer une commande.
   */
  #journal(text: string, kind: string): void {
    this.#bridge.recordJournal(kind, text).catch(() => {});
  }

  /** Une demande de confirmation venue du natif devient une fenêtre visible, avec ses deux réponses. */
  #presentConfirmation(request: ConfirmationRequest): void {
    const reply = replyFor(this.#locale);
    const title = reply.t(PERMISSION_TITLE[request.permission] ?? "confirm.title.generic");
    this.#emit({ type: "message", role: "assistant", text: reply.t("confirm.asked", { title }), tone: "info", locale: reply.locale });
    this.#emit({
      type: "present",
      content: {
        kind: "confirmation",
        requestId: request.id,
        title,
        rows: request.rows.map((row) => ({ label: reply.t(ROW_LABEL[row.key] ?? "confirm.row.generic"), value: row.value })),
        approve: reply.t("confirm.approve"),
        refuse: reply.t("confirm.refuse"),
        ...(request.rememberable && request.scope
          ? {
              remember: {
                label: reply.t(request.permission === "agent.run" ? "confirm.remember.project" : "confirm.remember.folder", {
                  scope: request.scope,
                }),
              },
            }
          : {}),
      },
      source: { capabilityId: "permissions", locality: "local", collectedAt: Date.now() },
    });
  }

  /** Une règle mémorisée a approuvé une action sans question : la conversation le dit, le natif le journalise. */
  #announceAutomatic(approval: AutoApproval): void {
    const key = RULE_ACTION[approval.permission];
    if (!key) return;
    const reply = replyFor(this.#locale);
    const action = reply.t(key);
    this.#emit({ type: "message", role: "assistant", text: reply.t("rule.announced", { action, scope: approval.scope }), tone: "info", locale: reply.locale });
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
