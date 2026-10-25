import { registerPacks } from "../plugins/packs";
import { Conversation, answerClarification } from "../conversation/conversation";
import type { Clarification } from "../conversation/types";
import { FirstConversation } from "../onboarding/firstConversation";
import { CapabilityError, toCapabilityError } from "../capabilities/errors";
import { CapabilityRegistry } from "../capabilities/registry";
import type { CapabilityContext, CapabilityInput, CapabilityResult, Permission, SourceRef } from "../capabilities/types";
import { applicationSearchName, pluginCommandsForModel, registerLanguageDictionary } from "../intent/registry";
import { loadBuiltinPlugins } from "../plugins/builtin";
import type { PluginStatus } from "../plugins/types";
import type { Intent } from "../intent/types";
import type { Classifier } from "../language-model/benchmark";
import { understandWithModel } from "../language-model/branch";
import { fallbackClassifier, nativeClassifier, nimClassifier } from "../language-model/classifier";
import { readSelectedModel } from "../language-model/selection";
import { buildContext, CONTEXT_SHARES, type ContextShare } from "../language-model/context";
import { ConnectorFlow } from "../connectors/flow";
import { ASK_PAGES, ASK_SYSTEM, parseWebAnswer, webSources } from "../web/ask";
import { MemoryController } from "../memory/memory";
import { ScheduleController, type ScheduledTask } from "../schedule/controller";
import { describeRecurrence } from "../schedule/recurrence";
import { RoutineDetector, type RoutineProposal, type RoutineStorage } from "../routines/detector";
import { AlertMonitor } from "../alerts/monitor";
import { eventsOn, parseIcs } from "../agenda/ics";
import type { SystemInfo } from "../native/adapter";
import { createNativeAdapter, type NativeAdapter } from "../native";
import { createOsintRunner } from "../osint/runner";
import { createNativeBridge, type AutoApproval, type ConfirmationNotice, type NativeBridge } from "../native/bridge";
import { permissionTitle } from "../confirmations/content";
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
  /** Clé et modèle NVIDIA NIM, si l'utilisateur les a activés. Sinon null : tout reste sur ce poste. */
  onlineModel?: () => { model: string; share: ContextShare[] } | null;
  /** Chemin du fichier d'agenda (.ics), ou null. Lu seulement quand l'utilisateur demande son agenda. */
  agendaPath?: () => string | null;
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
  "connector.install",
  "connector.call",
];

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
  #alertTimer: ReturnType<typeof setInterval> | undefined;
  /** Alertes proactives : chaque alerte n'est annoncée qu'une fois tant qu'elle dure. */
  readonly #monitor = new AlertMonitor();
  readonly #agendaPath: () => string | null;
  /** Modèle local qui rédige les réponses aux questions ouvertes sur le web. */
  readonly #model: () => string | null;
  /** Échange récent, borné : le modèle s'y réfère pour les demandes qui parlent de ce qui précède. */
  readonly #history: { role: "user" | "assistant"; text: string }[] = [];
  /** Question sur l'écran en attente de la confirmation de l'utilisateur. */
  #visionPending: { question: string; model: string } | undefined;
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
    this.#agendaPath = options.agendaPath ?? (() => null);
    this.#model = options.model ?? readSelectedModel;
    this.#schedule = new ScheduleController({
      bridge: this.#bridge,
      say: (text, tone) => this.#reply(replyFor(this.#locale), text, tone),
      t: (key, params) => translate(this.#locale, key, params),
      run: (request) => this.#runScheduled(request),
    });
    const local = nativeClassifier(this.#bridge, options.model ?? readSelectedModel, () => this.classifierContext(new Set(CONTEXT_SHARES)));
    const online = options.onlineModel ?? (() => null);
    // NIM d'abord si l'utilisateur l'a activé, avec seulement les catégories qu'il a cochées ; sinon, le modèle local.
    const onlineContext = () => this.classifierContext(new Set(online()?.share ?? []));
    this.#classifier = fallbackClassifier(nimClassifier(this.#bridge, online, onlineContext), local);
    this.#connectors = new ConnectorFlow({
      bridge: this.#bridge,
      model: () => readSelectedModel(),
      say: (text, tone) => this.#reply(replyFor(this.#locale), text, tone),
      t: (key, params) => translate(this.#locale, key, params),
    });
    this.#unsubscribeConfirmations = this.#bridge.onConfirmationNotice((notice) => this.#presentConfirmation(notice));
    this.#unsubscribeAutoApprovals = this.#bridge.onAutoApproval((approval) => this.#announceAutomatic(approval));
    this.#locale = options.locale;
    this.#holdMs = options.responseHoldMs ?? 2500;
    this.#registry = new CapabilityRegistry(options.grantedPermissions ?? DEFAULT_GRANTED);
    this.#plugins = loadBuiltinPlugins({
      registerCapability: (manifest, handler) => this.#registry.register(manifest, handler),
      registerLanguage: (locale, dictionary) => registerLanguageDictionary(locale, dictionary),
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
    clearInterval(this.#alertTimer);
    void this.#checkSystem();
    this.#alertTimer = setInterval(() => void this.#checkSystem(), ALERT_INTERVAL_MS);
  }

  /** Disque ou mémoire qui se dégradent : une alerte, annoncée une fois tant qu'elle dure. Une panne de lecture est ignorée. */
  async #checkSystem(): Promise<void> {
    let info: SystemInfo;
    try {
      info = await this.#native.systemInfo();
    } catch {
      return;
    }
    // Un poste sans batterie, ou une lecture impossible, ne bloque pas les autres alertes.
    const battery = await this.#bridge.batteryStatus().catch(() => null);
    const reply = replyFor(this.#locale);
    for (const alert of this.#monitor.check(info, battery)) {
      const what = alert.kind === "disk" ? reply.t("alert.disk", { label: alert.label }) : alert.kind === "battery" ? reply.t("alert.battery") : reply.t("alert.memory");
      this.#emit({
        type: "present",
        content: { kind: "information-card", title: reply.t("alert.title"), rows: [{ label: what, value: alert.detail }] },
        source: { capabilityId: "system.alerts", locality: "local", collectedAt: Date.now() },
      });
      this.#reply(reply, reply.t("alert.raised", { what, detail: alert.detail }));
    }
  }

  /** Arrête la vérification des tâches programmées (l'interface la relance au montage suivant). */
  stopScheduler(): void {
    clearInterval(this.#scheduleTimer);
    this.#scheduleTimer = undefined;
    clearInterval(this.#alertTimer);
    this.#alertTimer = undefined;
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
    if (await this.#consumeVision(text)) return;
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
  /** Contexte de la classification : seules les catégories demandées sont incluses (le modèle local demande tout). */
  async classifierContext(share: ReadonlySet<ContextShare>): Promise<string[]> {
    const shown = this.#conversation.referents();
    const now = new Date();
    const commands = pluginCommandsForModel();
    const system = [`Date et heure actuelles : ${localDateTime(now)} (${now.toLocaleDateString("fr-FR", { weekday: "long" })}).`];
    if (commands.length > 0) system.push(`Commandes des plugins installées (PLUGIN_ACTION : pluginId, command, text) : ${commands.join(" ; ")}`);
    return buildContext(
      {
        conversation: this.#recentConversation(),
        memories: share.has("memories") ? await this.#memory.texts() : [],
        shown:
          shown.length > 0
            ? `Éléments affichés à l'utilisateur : ${shown.map((referent, index) => `${index + 1}) ${referent.label} (${referent.value})`).join(" · ")}`
            : null,
        system,
      },
      share,
    );
  }

  /** Ouvre la liste des tâches programmées (bouton de la barre). */
  showSchedules(): Promise<void> {
    return this.#showSchedules(replyFor(this.#locale));
  }

  /** Les tâches programmées, pour le panneau Planning. */
  scheduledTasks(): Promise<ScheduledTask[]> {
    return this.#schedule.snapshot();
  }

  /** Annule une tâche programmée depuis le panneau Planning. */
  cancelScheduledTask(id: number): Promise<void> {
    return this.#schedule.removeById(id);
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
        // Aucun catalogue : le nom (ou son alias installé) est cherché sur ce PC par le natif.
        const name = applicationSearchName(intent.appName);
        return this.#runCapability("apps.launch", { appName: name }, { labelKey: "task.openApp", labelParams: { app: name } }, reply);
      }
      case "SYSTEM_INFO":
        return this.#runCapability("system.info", {}, { labelKey: "task.systemInfo" }, reply);
      case "OSINT_DOMAIN":
        return this.#runCapability("osint.domain", { domain: intent.domain }, { labelKey: "task.osintDomain", labelParams: { domain: intent.domain } }, reply);
      case "OSINT_USERNAME":
        return this.#runCapability("osint.username", { username: intent.username }, { labelKey: "task.osintUsername", labelParams: { username: intent.username } }, reply);
      case "DOCUMENT_INSPECT":
        return this.#runCapability("document.inspect", { path: intent.path }, { labelKey: "task.inspectFile", labelParams: { file: intent.path.split(/[\\/]/).pop() ?? intent.path } }, reply);
      case "FILE_VIEW":
        return this.#runCapability("files.view", { path: intent.path }, { labelKey: "task.fileView", labelParams: { file: intent.path.split(/[\\/]/).pop() ?? intent.path } }, reply);
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
        return this.#showSchedules(reply);
      case "AGENDA_TODAY":
        return this.#showAgenda(reply);
      case "SCREEN_VIEW":
        return this.#askScreen(intent.question, reply);
      case "DRAFT_MESSAGE":
        return this.#showDraft(intent.recipient, intent.text, reply);
      case "CANCEL_SCHEDULE":
        return this.#schedule.cancel(intent.query);
      case "NEEDS_CONNECTOR":
        // Le modèle a reconnu un service extérieur : on cherche un connecteur de confiance et on propose de l'installer.
        return this.#connectors.start(intent.task, intent.service);
      case "SHOW_IMAGE":
        return this.#showPhoto(intent.query, reply);
      case "SHOW_TOPIC":
        return this.#showTopic(intent.query, reply);
      case "ASK_WEB":
        return this.#askWeb(intent.question, reply);
      case "NEWS_SUMMARY":
        return this.#showNews(intent.topic, reply);
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

  /** Les rendez-vous du jour, dans une fenêtre tableau. Sans fichier désigné, NEXUS le dit et ne lit rien. */
  async #showAgenda(reply: Reply): Promise<void> {
    const path = this.#agendaPath();
    if (!path) return this.#reply(reply, reply.t("agenda.noFile"));
    try {
      const today = new Date();
      const events = eventsOn(parseIcs(await this.#bridge.agendaRead(path)), today);
      if (events.length === 0) return this.#reply(reply, reply.t("agenda.empty"));
      this.#emit({
        type: "present",
        content: {
          kind: "data-table",
          title: reply.t("agenda.title", { date: today.toLocaleDateString(reply.locale) }),
          columns: [reply.t("agenda.colWhen"), reply.t("agenda.colEvent")],
          rows: events.map((event) => [
            event.allDay ? reply.t("agenda.allDay") : event.start.toLocaleTimeString(reply.locale, { hour: "2-digit", minute: "2-digit" }),
            event.title,
          ]),
        },
        source: { capabilityId: "agenda", locality: "local", collectedAt: Date.now() },
      });
      this.#reply(reply, reply.t("agenda.reply", { count: events.length }));
    } catch (error) {
      this.#fail(toCapabilityError(error), reply);
    }
  }

  /**
   * Question sur l'écran : d'abord la confirmation, puis une seule capture, lue par le modèle de vision local.
   * Sans modèle de vision installé, NEXUS le dit et ne capture rien.
   */
  async #askScreen(question: string, reply: Reply): Promise<void> {
    const status = await this.#bridge.ollamaStatus().catch(() => null);
    // Parmi les modèles de vision installés, le plus gros : il lit mieux un écran chargé.
    const model = status?.models
      .filter((installed) => VISION_MODEL.test(installed.name))
      .sort((left, right) => right.sizeBytes - left.sizeBytes)[0]?.name;
    if (!model) return this.#reply(reply, reply.t("vision.noModel"), "error");
    this.#visionPending = { question, model };
    this.#reply(reply, reply.t("vision.confirm", { model }));
  }

  /** Réponse à la confirmation : « oui » fait une seule capture ; « non » annule. Une autre saisie abandonne la question. */
  async #consumeVision(text: string): Promise<boolean> {
    const pending = this.#visionPending;
    if (!pending) return false;
    this.#visionPending = undefined;
    const reply = replyFor(this.#locale);
    const answer = text.trim().toLowerCase();
    if (/^(?:non|no)$/.test(answer)) {
      this.#reply(reply, reply.t("vision.cancelled"));
      return true;
    }
    if (!/^(?:oui|yes|ok|d'accord|vas-y|go)$/.test(answer)) return false;
    try {
      const image = await this.#bridge.screenCapture();
      this.#emit({
        type: "present",
        content: { kind: "image-card", title: reply.t("vision.captured"), imageUrl: `data:image/png;base64,${image}`, credit: reply.t("vision.localOnly"), license: "", page: "" },
        source: { capabilityId: "vision", locality: "local", collectedAt: Date.now() },
      });
      const description = await this.#bridge.visionAsk(pending.model, pending.question, image);
      this.#reply(reply, description || reply.t("vision.empty"));
    } catch (error) {
      this.#fail(toCapabilityError(error), reply);
    }
    return true;
  }

  /** Un brouillon de message, à copier. Rien n'est envoyé : c'est toujours l'utilisateur qui envoie. */
  #showDraft(recipient: string | undefined, text: string, reply: Reply): void {
    this.#emit({
      type: "present",
      content: { kind: "draft", title: reply.t("draft.title"), recipient, text, note: reply.t("draft.note") },
      source: { capabilityId: "draft", locality: "local", collectedAt: Date.now() },
    });
    this.#reply(reply, reply.t("draft.reply"));
  }

  /** Les tâches programmées, dans une fenêtre tableau : demande, récurrence, prochaine exécution. */
  async #showSchedules(reply: Reply): Promise<void> {
    try {
      const tasks = await this.#schedule.snapshot();
      if (tasks.length === 0) return this.#reply(reply, reply.t("schedule.none"));
      this.#emit({
        type: "present",
        content: {
          kind: "data-table",
          title: reply.t("schedule.windowTitle"),
          columns: [reply.t("schedule.colRequest"), reply.t("schedule.colWhen"), reply.t("schedule.colNext")],
          rows: tasks.map((task) => [task.request, describeRecurrence(task.recurrence), new Date(task.nextRunAt).toLocaleString(reply.locale)]),
        },
        source: { capabilityId: "schedule", locality: "local", collectedAt: Date.now() },
      });
      this.#reply(reply, reply.t("schedule.windowReply", { count: tasks.length }));
    } catch (error) {
      this.#fail(toCapabilityError(error), reply);
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
  async #showNews(topic: string | undefined, reply: Reply): Promise<void> {
    this.#reply(reply, reply.t("web.searching", { query: topic ?? reply.t("web.newsQuery") }));
    try {
      const items = await this.#bridge.webNewsSearch(topic);
      if (items.length === 0) return this.#reply(reply, reply.t("web.newsEmpty"), "error");
      this.#emit({
        type: "present",
        content: { kind: "news-list", title: reply.t("web.newsTitle", { date: new Date().toLocaleDateString(reply.locale) }), items, source: reply.t("web.newsSourceWeb") },
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

  /**
   * Question ouverte : recherche, lecture des premières pages, puis réponse du modèle à partir de ces sources seules.
   * Sans source exploitable, NEXUS le dit plutôt que d'inventer.
   */
  async #askWeb(question: string, reply: Reply): Promise<void> {
    this.#reply(reply, reply.t("web.askSearching", { question }));
    try {
      const hits = await this.#bridge.webSearch(question);
      const pages = await Promise.all(hits.slice(0, ASK_PAGES).map((hit) => this.#bridge.webRead(hit.url).catch(() => null)));
      const sources = webSources(hits, pages);
      if (sources.length === 0) return this.#reply(reply, reply.t("web.askNone", { question }), "error");

      const model = this.#model();
      if (!model) return this.#reply(reply, reply.t("web.askNoModel"), "error");
      const raw = await this.#bridge.modelJson(model, ASK_SYSTEM, JSON.stringify({ question, sources }));
      const answer = parseWebAnswer(raw);
      if (!answer) return this.#reply(reply, reply.t("web.askUnclear"), "error");
      this.#reply(reply, `${answer}\n${reply.t("web.askSources", { sources: sources.map((source) => source.url).join(" · ") })}`);
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

  /**
   * Une demande de confirmation attend. Le natif la présente dans sa fenêtre dédiée, la seule qui peut y répondre :
   * la conversation annonce seulement qu'elle attend, avec son titre.
   */
  #presentConfirmation(notice: ConfirmationNotice): void {
    const reply = replyFor(this.#locale);
    const title = permissionTitle(this.#locale, notice.permission);
    this.#emit({ type: "message", role: "assistant", text: reply.t("confirm.asked", { title }), tone: "info", locale: reply.locale });
    this.#emit({ type: "message", role: "assistant", text: reply.t("confirm.answerInWindow"), tone: "info", locale: reply.locale });
    // Une carte sans boutons : l'interface principale montre ce qui attend, la décision se prend dans la fenêtre dédiée.
    this.#emit({
      type: "present",
      content: {
        kind: "information-card",
        title: reply.t("confirm.requiredTitle"),
        rows: [
          { label: reply.t("confirm.row.action"), value: title },
          { label: reply.t("confirm.row.answer"), value: reply.t("confirm.answerWhere") },
        ],
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
    if (event.type === "message") this.#remember(event.role, event.text);
    for (const listener of this.#listeners) listener(event);
  }

  /** Garde l'échange récent (demandes et réponses) : le modèle s'y réfère pour « elle », « ça », « la suite ». */
  #remember(role: "user" | "assistant", text: string): void {
    const kept = text.length > HISTORY_LINE_CHARS ? `${text.slice(0, HISTORY_LINE_CHARS)}…` : text;
    this.#history.push({ role, text: kept });
    if (this.#history.length > HISTORY_TURNS) this.#history.splice(0, this.#history.length - HISTORY_TURNS);
  }

  /** L'échange récent pour le contexte du modèle : les plus anciens d'abord, une ligne par message. */
  #recentConversation(): string | null {
    if (this.#history.length === 0) return null;
    const lines = this.#history.slice(-HISTORY_CONTEXT).map((entry) => `${entry.role === "user" ? "Utilisateur" : "NEXUS"} : ${entry.text}`);
    return `Conversation récente (la plus ancienne d'abord) : ${lines.join(" | ")}`;
  }
}

/** Date et heure locales au format « 2026-10-25T09:00 », lisible par le modèle et par la validation. */
function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Modèles capables de lire une image (noms usuels : qwen2.5vl, llava, minicpm-v, moondream, gemma3…). */
const VISION_MODEL = /vl|llava|vision|minicpm-v|moondream|gemma3/i;

/** Échanges gardés en mémoire de session, et nombre de messages donnés au modèle à chaque demande. */
const HISTORY_TURNS = 60;
const HISTORY_CONTEXT = 12;
const HISTORY_LINE_CHARS = 300;

/** Vérification des alertes système : toutes les cinq minutes tant que NEXUS tourne. */
const ALERT_INTERVAL_MS = 300_000;

/** Demandes qui ne forment pas une habitude : réponses, mémoire, tâches programmées, aide, connecteurs. */
const ROUTINE_EXCLUDED = new Set<Intent["type"]>(["CHAT", "UNKNOWN", "REMEMBER", "FORGET", "MEMORY_LIST", "SCHEDULE", "LIST_SCHEDULES", "CANCEL_SCHEDULE", "HELP", "NEEDS_CONNECTOR"]);

export function createEngine(options: EngineOptions): Engine {
  return new Engine(options);
}
