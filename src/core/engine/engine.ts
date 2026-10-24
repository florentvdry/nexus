import { registerPacks } from "../plugins/packs";
import { Conversation, answerClarification } from "../conversation/conversation";
import type { Clarification } from "../conversation/types";
import { FirstConversation } from "../onboarding/firstConversation";
import { CapabilityError, toCapabilityError } from "../capabilities/errors";
import { CapabilityRegistry } from "../capabilities/registry";
import type { CapabilityContext, CapabilityInput, CapabilityResult, Permission, SourceRef } from "../capabilities/types";
import { pluginCommandsForModel, registeredApplications, registerApplications, registerLanguageDictionary } from "../intent/registry";
import { loadBuiltinPlugins } from "../plugins/builtin";
import type { PluginStatus } from "../plugins/types";
import type { Intent } from "../intent/types";
import type { Classifier } from "../language-model/benchmark";
import { understandWithModel } from "../language-model/branch";
import { nativeClassifier } from "../language-model/classifier";
import { readSelectedModel } from "../language-model/selection";
import { ConnectorFlow } from "../connectors/flow";
import { MemoryController } from "../memory/memory";
import { ScheduleController } from "../schedule/controller";
import { RoutineDetector, type RoutineProposal, type RoutineStorage } from "../routines/detector";
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
  /** Stockage des routines repérées. Par défaut, celui du navigateur ; les tests le fixent. */
  routineStorage?: RoutineStorage;
  /** Modèle local utilisé pour comprendre. Par défaut, celui choisi dans les réglages ; les tests le fixent. */
  model?: () => string | null;
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
  /** Souvenirs : « retiens que… », oubli, liste, et propositions du modèle à confirmer. */
  readonly #memory: MemoryController;
  /** Première conversation après le setup : questions sur l'utilisateur, réponses gardées en souvenirs. */
  readonly #onboarding: FirstConversation;
  /** Tâches programmées : relancées à l'heure prévue, tant que NEXUS tourne. */
  readonly #schedule: ScheduleController;
  /** Routines repérées (demande répétée à la même heure) et proposition en attente d'un « oui ». */
  readonly #routines: RoutineDetector;
  #routinePending: RoutineProposal | undefined;
  #scheduleTimer: ReturnType<typeof setInterval> | undefined;
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
    this.#memory = new MemoryController({
      bridge: this.#bridge,
      say: (text, tone) => this.#reply(replyFor(this.#locale), text, tone),
      t: (key, params) => translate(this.#locale, key, params),
    });
    this.#onboarding = new FirstConversation({
      bridge: this.#bridge,
      say: (text, tone) => this.#reply(replyFor(this.#locale), text, tone),
      t: (key, params) => translate(this.#locale, key, params),
    });
    this.#routines = new RoutineDetector(options.routineStorage ?? (typeof window === "undefined" ? undefined : window.localStorage));
    this.#schedule = new ScheduleController({
      bridge: this.#bridge,
      say: (text, tone) => this.#reply(replyFor(this.#locale), text, tone),
      t: (key, params) => translate(this.#locale, key, params),
      run: (request) => this.#runScheduled(request),
    });
    this.#classifier = nativeClassifier(this.#bridge, options.model ?? readSelectedModel, () => this.classifierContext());
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
    clearInterval(this.#scheduleTimer);
  }

  /** Vérifie les tâches programmées tout de suite, puis à intervalle régulier. Appelé au démarrage de l'interface. */
  startScheduler(intervalMs = 30_000): void {
    clearInterval(this.#scheduleTimer);
    void this.#schedule.tick();
    this.#scheduleTimer = setInterval(() => void this.#schedule.tick(), intervalMs);
  }

  /** Arrête la vérification des tâches programmées (l'interface la relance au montage suivant). */
  stopScheduler(): void {
    clearInterval(this.#scheduleTimer);
    this.#scheduleTimer = undefined;
  }

  /** Une tâche programmée est relancée comme une demande tapée : mêmes règles, mêmes confirmations. */
  #runScheduled(request: string): Promise<void> {
    return this.#handle(request, replyFor(this.#locale));
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
   * Traite une saisie. Une étape en attente (connecteur, mémoire, première conversation, question à choix) reçoit
   * la saisie d'abord ; sinon toute demande passe par le modèle local, sans analyseur de texte.
   */
  async #handle(text: string, reply: Reply): Promise<void> {
    if (await this.#connectors.consume(text)) return;
    if (await this.#memory.consume(text)) return;
    if (await this.#onboarding.consume(text)) return;
    if (await this.#consumeRoutine(text)) return;
    const pending = this.#conversation.pending();
    if (pending) {
      this.#conversation.clearPending();
      const answer = answerClarification(pending, text);
      if (answer === "cancel") return this.#reply(reply, reply.t("clarify.cancelled"));
      if (answer) return this.#handle(answer.text, reply);
    }

    const { intent, source } = await understandWithModel(text, this.#classifier);
    this.#journal(text, intent.type);
    if (source === "unavailable") return this.#reply(reply, reply.t("model.unavailable"), "error");
    await this.#route(intent, reply);
    // La réponse d'abord, la proposition de routine ensuite : elle n'arrive jamais à la place de la réponse.
    if (source === "model" && !ROUTINE_EXCLUDED.has(intent.type)) this.#observeRoutine(text, reply);
  }

  /** Une demande répétée à la même heure devient une proposition ; rien n'est programmé sans « oui ». */
  #observeRoutine(text: string, reply: Reply): void {
    // Une tâche programmée qui se relance ne compte pas comme une habitude de l'utilisateur.
    if (this.#schedule.executing) return;
    const proposal = this.#routines.observe(text);
    if (!proposal) return;
    this.#routinePending = proposal;
    this.#reply(reply, reply.t("routine.propose", { request: proposal.request, time: `${String(proposal.hour).padStart(2, "0")}:00` }));
  }

  /** Répond à la proposition de routine : « oui » programme chaque jour à l'heure repérée, « non » ne fait rien. */
  async #consumeRoutine(text: string): Promise<boolean> {
    const proposal = this.#routinePending;
    if (!proposal) return false;
    this.#routinePending = undefined;
    const answer = text.trim().toLowerCase();
    if (/^(?:oui|yes|ok|d'accord|vas-y|go)$/.test(answer)) {
      await this.#schedule.add(proposal.request, { kind: "daily", time: `${String(proposal.hour).padStart(2, "0")}:00` });
      return true;
    }
    if (/^(?:non|no)$/.test(answer)) {
      this.#reply(replyFor(this.#locale), replyFor(this.#locale).t("routine.declined"));
      return true;
    }
    return false;
  }

  /**
   * Contexte donné au modèle avec chaque demande : les souvenirs de l'utilisateur, et les éléments que NEXUS vient
   * d'afficher (« ferme le deuxième »). Ce sont des données, jamais des instructions.
   */
  async classifierContext(): Promise<string[]> {
    const context = await this.#memory.texts();
    const shown = this.#conversation.referents();
    if (shown.length > 0) {
      const list = shown.map((referent, index) => `${index + 1}) ${referent.label} (${referent.value})`).join(" · ");
      context.push(`Éléments affichés à l'utilisateur : ${list}`);
    }
    const now = new Date();
    context.push(`Date et heure actuelles : ${localDateTime(now)} (${now.toLocaleDateString("fr-FR", { weekday: "long" })}).`);
    const commands = pluginCommandsForModel();
    if (commands.length > 0) context.push(`Commandes des plugins installés (PLUGIN_ACTION : pluginId, command, text) : ${commands.join(" ; ")}`);
    return context;
  }

  /** Première conversation, après le setup : NEXUS pose ses questions et garde les réponses en souvenirs. */
  startFirstConversation(): void {
    this.#onboarding.start();
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
      case "REMEMBER":
        // Une information sur l'utilisateur est gardée sans question : c'est le modèle qui juge ce qui compte.
        return this.#memory.remember(intent.text);
      case "FORGET":
        return this.#memory.forget(intent.query);
      case "MEMORY_LIST":
        return this.#memory.list();
      case "SCHEDULE":
        // Une tâche programmée ne programme pas d'autres tâches : pas de boucle sans fin.
        if (this.#schedule.executing) return this.#reply(reply, reply.t("schedule.nested"), "error");
        return this.#schedule.add(intent.request, intent.recurrence);
      case "LIST_SCHEDULES":
        return this.#schedule.list();
      case "CANCEL_SCHEDULE":
        return this.#schedule.cancel(intent.query);
      case "NEEDS_CONNECTOR":
        // Le modèle a reconnu un service extérieur : on cherche un connecteur de confiance et on propose de l'installer.
        return this.#connectors.start(intent.task, intent.service);
      case "SHOW_IMAGE":
        return this.#showPhoto(intent.query, reply);
      case "SHOW_TOPIC":
        return this.#showTopic(intent.query, reply);
      case "NEWS_SUMMARY":
        return this.#showNews(reply);
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
        // Le modèle n'a rien reconnu et n'a rien répondu : c'est une vraie incompréhension.
        return this.#reply(reply, reply.t("intent.unknown", { text: intent.text }), "error");
    }
  }

  /** Une photo libre du sujet, dans sa fenêtre, avec son auteur et sa licence. */
  async #showPhoto(query: string, reply: Reply): Promise<void> {
    // Retour immédiat : la recherche peut prendre quelques secondes.
    this.#reply(reply, reply.t("web.searching", { query }));
    try {
      const photo = await this.#bridge.webPhoto(query);
      this.#emit({
        type: "present",
        content: { kind: "image-card", title: photo.title, imageUrl: photo.dataUrl, credit: photo.credit, license: photo.license, page: photo.page },
        source: { capabilityId: "web.photo", locality: "network", collectedAt: Date.now() },
      });
      this.#reply(reply, reply.t("web.photo", { title: photo.title }));
    } catch (error) {
      this.#fail(toCapabilityError(error), reply);
    }
  }

  /**
   * L'actualité du jour, dans une fenêtre liste. Si Wikipédia n'a pas encore publié la journée, la veille fait foi,
   * et la date affichée est celle de la source.
   */
  async #showNews(reply: Reply): Promise<void> {
    this.#reply(reply, reply.t("web.searching", { query: reply.t("web.newsQuery") }));
    try {
      const headlines = await this.#bridge.webHeadlines().catch(() => []);
      const today = new Date();
      let wikiDate = localDate(today);
      let wiki = await this.#bridge.webNews(wikiDate).catch(() => []);
      if (wiki.length === 0) {
        wikiDate = localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
        wiki = await this.#bridge.webNews(wikiDate).catch(() => []);
      }
      const items = [...headlines, ...wiki];
      if (items.length === 0) return this.#reply(reply, reply.t("web.newsEmpty"), "error");
      const sources = [
        headlines.length > 0 ? "France 24" : undefined,
        wiki.length > 0 ? reply.t("web.sourceWiki", { date: wikiDate }) : undefined,
      ].filter((name): name is string => name !== undefined);
      this.#emit({
        type: "present",
        content: { kind: "news-list", title: reply.t("web.newsTitle", { date: localDate(today) }), items, source: reply.t("web.newsSources", { sources: sources.join(" · ") }) },
        source: { capabilityId: "web.news", locality: "network", collectedAt: Date.now() },
      });
      this.#reply(reply, reply.t("web.newsReply", { count: items.length }));
    } catch (error) {
      this.#fail(toCapabilityError(error), reply);
    }
  }

  /** Le résumé d'un sujet (Wikipédia), dans sa fenêtre, avec la page d'origine. */
  async #showTopic(query: string, reply: Reply): Promise<void> {
    this.#reply(reply, reply.t("web.searching", { query }));
    try {
      const summary = await this.#bridge.webSummary(query);
      this.#emit({
        type: "present",
        content: { kind: "article-card", title: summary.title, extract: summary.extract, page: summary.page },
        source: { capabilityId: "web.summary", locality: "network", collectedAt: Date.now() },
      });
      this.#reply(reply, reply.t("web.topic", { title: summary.title }));
    } catch (error) {
      this.#fail(toCapabilityError(error), reply);
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

/** Date locale au format AAAA-MM-JJ. */
function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Date et heure locales au format « 2026-10-25T09:00 », lisible par le modèle et par la validation. */
function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Demandes qui ne forment pas une habitude : réponses, mémoire, tâches programmées, aide, connecteurs. */
const ROUTINE_EXCLUDED = new Set<Intent["type"]>(["CHAT", "UNKNOWN", "REMEMBER", "FORGET", "MEMORY_LIST", "SCHEDULE", "LIST_SCHEDULES", "CANCEL_SCHEDULE", "HELP", "NEEDS_CONNECTOR"]);

export function createEngine(options: EngineOptions): Engine {
  return new Engine(options);
}
