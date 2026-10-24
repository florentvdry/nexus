import type { MessageKey } from "../../i18n/messages";
import type { ConnectorCandidate, InstalledConnector, McpTool } from "./types";

/**
 * Connecteurs MCP, conversation en étapes (TODO « connecteurs »). Une demande que NEXUS ne sait pas pinter seul
 * (« envoie un message Discord ») devient une recherche dans le catalogue de confiance, puis :
 *   1. proposition d'installer le connecteur trouvé (oui / non) ;
 *   2. saisie des variables requises (jeton…), une à une, sans jamais les réafficher ;
 *   3. choix de l'outil et de ses arguments par le modèle local, validés ici ;
 *   4. confirmation de l'action, puis appel de l'outil.
 * Rien n'est installé ni envoyé sans réponse explicite de l'utilisateur.
 */

export interface ConnectorBridge {
  mcpSearch(query: string): Promise<ConnectorCandidate[]>;
  mcpInstalled(): Promise<InstalledConnector[]>;
  mcpInstall(id: string): Promise<InstalledConnector>;
  mcpSetValue(id: string, name: string, value: string): Promise<void>;
  mcpTools(id: string): Promise<McpTool[]>;
  mcpCall(id: string, tool: string, args: Record<string, unknown>): Promise<string>;
  modelJson(model: string, system: string, user: string): Promise<unknown>;
}

export interface ConnectorFlowOptions {
  bridge: ConnectorBridge;
  /** Modèle local choisi par l'utilisateur, ou `null` si aucun n'est prêt. */
  model: () => string | null;
  say: (text: string, tone?: "info" | "error") => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

type Step =
  | { kind: "offer"; candidate: ConnectorCandidate; task: string }
  | { kind: "secret"; id: string; title: string; names: string[]; task: string }
  | { kind: "confirm"; id: string; tool: string; args: Record<string, unknown>; task: string };

const YES = /^(?:oui|yes|ok|d accord|vas y|installer|confirme|confirmer|1)$/i;
const NO = /^(?:non|no|annule|annuler|laisse tomber|stop|cancel|2)$/i;
/** Annulation pendant la saisie d'une valeur : seul le mot d'annulation compte, une valeur « non » reste une valeur. */
const CANCEL = /^(?:annule|annuler|laisse tomber|stop|cancel)$/i;
const MAX_QUERY = 60;
const MAX_ARGUMENTS_TEXT = 300;
const MAX_SCHEMA_TEXT = 1500;

const SELECTION_SYSTEM =
  "Tu choisis l'outil à appeler pour accomplir une tâche, parmi ceux de la liste, et ses arguments. " +
  'Réponds uniquement par un objet JSON : {"tool": "nom de l\'outil", "arguments": {...}}. ' +
  'Utilise uniquement les noms de la liste et les champs de son schéma. Si aucun outil ne convient, réponds {"tool": null}.';

/** Terme de recherche : le nom du service, ou les mots de la demande, sans ponctuation ni symbole. */
export function searchTerm(service: string | undefined, task: string): string {
  const source = service ?? task;
  return source.replace(/[^\p{L}\p{N}\-_. ]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
}

/** Réponse d'un modèle : un outil de la liste et des arguments en objet, ou rien. */
export function parseSelection(raw: unknown, tools: readonly McpTool[]): { tool: string; args: Record<string, unknown> } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  const tool = candidate.tool;
  const args = candidate.arguments ?? {};
  if (typeof tool !== "string" || !tools.some((item) => item.name === tool)) return null;
  if (typeof args !== "object" || args === null || Array.isArray(args)) return null;
  return { tool, args: args as Record<string, unknown> };
}

export class ConnectorFlow {
  readonly #options: ConnectorFlowOptions;
  #step: Step | undefined;

  constructor(options: ConnectorFlowOptions) {
    this.#options = options;
  }

  /** Vrai quand la prochaine saisie est la valeur d'une variable : elle ne doit pas être affichée dans la conversation. */
  get awaitsSecret(): boolean {
    return this.#step?.kind === "secret";
  }

  /** Demande une installation : recherche dans le catalogue, puis proposition. */
  async start(task: string, service: string | undefined): Promise<void> {
    const term = searchTerm(service, task);
    if (term.length < 2) return this.#options.say(this.#options.t("connector.none", { service: service ?? task }));
    let found: ConnectorCandidate[];
    try {
      found = await this.#options.bridge.mcpSearch(term);
    } catch (error) {
      return this.#options.say(this.#options.t("connector.searchFailed", { message: messageOf(error) }), "error");
    }
    const [best] = found;
    if (!best) return this.#options.say(this.#options.t("connector.none", { service: service ?? term }));
    this.#step = { kind: "offer", candidate: best, task };
    this.#options.say(
      this.#options.t("connector.offer", { title: best.title, stars: best.stars, repository: best.repository, task }),
    );
  }

  /**
   * Traite la saisie si une étape est en attente. Renvoie `false` quand la saisie ne répond pas à l'étape : elle
   * est alors traitée comme une nouvelle demande, et l'étape en attente est abandonnée.
   */
  async consume(text: string): Promise<boolean> {
    const step = this.#step;
    if (!step) return false;
    const trimmed = text.trim();

    if (step.kind === "secret") {
      if (CANCEL.test(trimmed)) return this.#cancel();
      return this.#saveSecret(step, trimmed);
    }
    if (NO.test(trimmed)) return this.#cancel();
    if (!YES.test(trimmed)) {
      this.#step = undefined;
      return false;
    }
    if (step.kind === "offer") {
      await this.#install(step.candidate, step.task);
      return true;
    }
    this.#step = undefined;
    await this.#run(step);
    return true;
  }

  #cancel(): boolean {
    this.#step = undefined;
    this.#options.say(this.#options.t("connector.cancelled"));
    return true;
  }

  async #install(candidate: ConnectorCandidate, task: string): Promise<void> {
    this.#step = undefined;
    let installed: InstalledConnector;
    try {
      installed = await this.#options.bridge.mcpInstall(candidate.id);
    } catch (error) {
      return this.#options.say(this.#options.t("connector.failed", { message: messageOf(error) }), "error");
    }
    await this.#prepare(installed, task);
  }

  /** Demande les variables requises une à une, puis passe au choix de l'outil. */
  async #prepare(installed: InstalledConnector, task: string): Promise<void> {
    const missing = installed.variables.filter((variable) => variable.required && !variable.isSet).map((variable) => variable.name);
    if (missing.length > 0) {
      this.#step = { kind: "secret", id: installed.id, title: installed.title, names: missing, task };
      this.#options.say(this.#options.t("connector.secret", { title: installed.title, name: missing[0] }));
      return;
    }
    await this.#select(installed.id, task);
  }

  async #saveSecret(step: Extract<Step, { kind: "secret" }>, value: string): Promise<boolean> {
    const [name, ...rest] = step.names;
    try {
      await this.#options.bridge.mcpSetValue(step.id, name, value);
    } catch (error) {
      this.#options.say(this.#options.t("connector.failed", { message: messageOf(error) }), "error");
      return true;
    }
    this.#options.say(this.#options.t("connector.secretSaved"));
    if (rest.length > 0) {
      this.#step = { ...step, names: rest };
      this.#options.say(this.#options.t("connector.secret", { title: step.title, name: rest[0] }));
      return true;
    }
    this.#step = undefined;
    const installed = (await this.#options.bridge.mcpInstalled().catch(() => [])).find((item) => item.id === step.id);
    if (installed) await this.#select(installed.id, step.task);
    return true;
  }

  /** Le modèle choisit l'outil ; la réponse est validée avant toute suite, puis l'utilisateur confirme. */
  async #select(id: string, task: string): Promise<void> {
    const model = this.#options.model();
    if (model === null) return this.#options.say(this.#options.t("connector.noModel"), "error");
    let tools: McpTool[];
    try {
      tools = await this.#options.bridge.mcpTools(id);
    } catch (error) {
      return this.#options.say(this.#options.t("connector.failed", { message: messageOf(error) }), "error");
    }
    if (tools.length === 0) return this.#options.say(this.#options.t("connector.noTool"), "error");

    const catalogue = tools.map((tool) => ({ name: tool.name, description: tool.description, schema: truncate(JSON.stringify(tool.inputSchema), MAX_SCHEMA_TEXT) }));
    let raw: unknown;
    try {
      raw = await this.#options.bridge.modelJson(model, SELECTION_SYSTEM, JSON.stringify({ task, tools: catalogue }));
    } catch (error) {
      return this.#options.say(this.#options.t("connector.failed", { message: messageOf(error) }), "error");
    }
    const selection = parseSelection(raw, tools);
    if (!selection) return this.#options.say(this.#options.t("connector.noTool"), "error");

    this.#step = { kind: "confirm", id, tool: selection.tool, args: selection.args, task };
    this.#options.say(
      this.#options.t("connector.confirm", { tool: selection.tool, arguments: truncate(JSON.stringify(selection.args), MAX_ARGUMENTS_TEXT) }),
    );
  }

  async #run(step: Extract<Step, { kind: "confirm" }>): Promise<void> {
    try {
      const text = await this.#options.bridge.mcpCall(step.id, step.tool, step.args);
      this.#options.say(this.#options.t("connector.done", { text }));
    } catch (error) {
      this.#options.say(this.#options.t("connector.failed", { message: messageOf(error) }), "error");
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
