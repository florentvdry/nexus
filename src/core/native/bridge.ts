import { listen } from "@tauri-apps/api/event";

import { NativeUnavailableError } from "./adapter";
import { isDesktopRuntime } from "./index";
import { callNative } from "./tauri-adapter";

// Pont vers les fonctions natives de la phase 4. Chaque appel passe par le courtier de permissions côté Rust :
// l'interface ne peut pas contourner une confirmation.

export interface ProcessEntry {
  name: string;
  pid: number;
  cpuPercent: number;
  memoryBytes: number;
}

export interface FileEntry {
  path: string;
  name: string;
  size: number;
  modified: number;
}

export interface FileSearchQuery {
  nameContains?: string;
  extension?: string;
  modifiedWithinDays?: number;
  /** Dossier précis, dans un emplacement autorisé. */
  folder?: string;
  /** Dossier désigné par son nom : `downloads`, `documents`, `desktop` ou `pictures`. */
  folderHint?: string;
}

export type FileOperation =
  | { kind: "rename"; from: string; newName: string }
  | { kind: "move"; from: string; toDir: string }
  | { kind: "copy"; from: string; toDir: string }
  | { kind: "trash"; path: string };

export interface AgentDetection {
  path: string | null;
  version: string | null;
}

export type AgentEvent =
  | { kind: "started"; model: string | null; cwd: string | null }
  | { kind: "tool"; name: string; summary: string }
  | { kind: "text"; text: string }
  | { kind: "result"; isError: boolean; text: string; costUsd: number; turns: number; durationMs: number; denials: string[] }
  | { kind: "error"; message: string }
  | { kind: "cancelled" };

export interface ConfirmationRequest {
  id: string;
  /** Identifiant de permission, p. ex. `file.delete`. */
  permission: string;
  rows: { key: string; value: string }[];
  expiresInSecs: number;
}

export interface WindowEntry {
  /** Identifiant natif de la fenêtre. Il n'est valable que tant que la fenêtre existe. */
  id: number;
  title: string;
  process: string;
  pid: number;
}

export interface NativeBridge {
  /** Pont dont les appels sont attribués à un plugin : le natif n'accorde que les permissions de son manifeste. */
  forPlugin(pluginId: string): NativeBridge;
  listWindows(): Promise<WindowEntry[]>;
  focusWindow(id: number): Promise<void>;
  closeWindow(id: number): Promise<void>;
  listProcesses(limit: number): Promise<ProcessEntry[]>;
  searchFiles(query: FileSearchQuery): Promise<FileEntry[]>;
  operateFile(operation: FileOperation): Promise<string>;
  detectAgent(): Promise<AgentDetection>;
  runAgent(runId: string, project: string, prompt: string): Promise<void>;
  cancelAgent(runId: string): Promise<boolean>;
  onAgentEvent(listener: (runId: string, event: AgentEvent) => void): () => void;
  onConfirmationRequest(listener: (request: ConfirmationRequest) => void): () => void;
  answerConfirmation(id: string, approved: boolean): Promise<void>;
}

/** Identité de l'interface principale : elle ne peut que répondre aux confirmations. */
export const CORE_CALLER = "core";
const AGENT_CHANNEL = "agents://event";
const CONFIRMATION_CHANNEL = "permissions://request";

export class TauriNativeBridge implements NativeBridge {
  readonly #caller: string;

  constructor(caller: string = CORE_CALLER) {
    this.#caller = caller;
  }

  forPlugin(pluginId: string): NativeBridge {
    return new TauriNativeBridge(pluginId);
  }

  /** Chaque appel transmet l'identité de l'appelant : le natif vérifie la permission correspondante. */
  #call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    return callNative<T>(command, { caller: this.#caller, ...args });
  }

  listProcesses(limit: number): Promise<ProcessEntry[]> {
    return this.#call<ProcessEntry[]>("processes_list", { limit });
  }

  searchFiles(query: FileSearchQuery): Promise<FileEntry[]> {
    return this.#call<FileEntry[]>("files_search", { query });
  }

  operateFile(operation: FileOperation): Promise<string> {
    return this.#call<string>("files_operate", { operation });
  }

  detectAgent(): Promise<AgentDetection> {
    return this.#call<AgentDetection>("agent_detect");
  }

  runAgent(runId: string, project: string, prompt: string): Promise<void> {
    return this.#call<void>("agent_run", { runId, project, prompt });
  }

  cancelAgent(runId: string): Promise<boolean> {
    return this.#call<boolean>("agent_cancel", { runId });
  }

  listWindows(): Promise<WindowEntry[]> {
    return this.#call<WindowEntry[]>("window_list");
  }

  focusWindow(id: number): Promise<void> {
    return this.#call<void>("window_focus", { id });
  }

  closeWindow(id: number): Promise<void> {
    return this.#call<void>("window_close", { id });
  }

  onAgentEvent(listener: (runId: string, event: AgentEvent) => void): () => void {
    const unlisten = listen<AgentEvent & { runId: string }>(AGENT_CHANNEL, (message) => {
      const { runId, ...event } = message.payload;
      listener(runId, event as AgentEvent);
    });
    return () => void unlisten.then((stop) => stop());
  }

  onConfirmationRequest(listener: (request: ConfirmationRequest) => void): () => void {
    const unlisten = listen<ConfirmationRequest>(CONFIRMATION_CHANNEL, (message) => listener(message.payload));
    return () => void unlisten.then((stop) => stop());
  }

  answerConfirmation(id: string, approved: boolean): Promise<void> {
    return this.#call<void>("permission_answer", { id, approved });
  }
}

export class UnavailableNativeBridge implements NativeBridge {
  private unavailable(): Promise<never> {
    return Promise.reject(new NativeUnavailableError());
  }

  forPlugin = (): NativeBridge => this;
  listWindows = () => this.unavailable();
  focusWindow = () => this.unavailable();
  closeWindow = () => this.unavailable();
  listProcesses = () => this.unavailable();
  searchFiles = () => this.unavailable();
  operateFile = () => this.unavailable();
  detectAgent = () => this.unavailable();
  runAgent = () => this.unavailable();
  cancelAgent = () => this.unavailable();
  answerConfirmation = () => this.unavailable();
  onAgentEvent = () => () => {};
  onConfirmationRequest = () => () => {};
}

export function createNativeBridge(): NativeBridge {
  return isDesktopRuntime() ? new TauriNativeBridge() : new UnavailableNativeBridge();
}
