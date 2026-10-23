// Contrat entre le Core Engine et le Windows Adapter (Rust). Le core ne connaît que ces types.

export interface DiskInfo {
  mountPoint: string;
  totalBytes: number;
  availableBytes: number;
}

export interface SystemInfo {
  osName: string;
  hostName: string;
  cpuBrand: string;
  cpuCount: number;
  cpuUsagePercent: number;
  memoryTotalBytes: number;
  memoryUsedBytes: number;
  disks: DiskInfo[];
  uptimeSeconds: number;
}

export interface LaunchOutcome {
  appId: string;
  displayName: string;
  pid: number;
}

export interface AppStatus {
  id: string;
  displayName: string;
  installed: boolean;
}

export interface NativeAdapter {
  systemInfo(): Promise<SystemInfo>;
  launchApp(appId: string): Promise<LaunchOutcome>;
  listApps(): Promise<AppStatus[]>;
}

/** Erreur structurée renvoyée par le backend natif. */
export class NativeCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeCallError";
  }
}

/** Levée quand le core tourne hors de l'application de bureau (ex. navigateur de développement). */
export class NativeUnavailableError extends Error {
  constructor() {
    super("Backend natif indisponible");
    this.name = "NativeUnavailableError";
  }
}

export function toNativeCallError(payload: unknown): NativeCallError {
  if (payload && typeof payload === "object" && "code" in payload) {
    const { code, message } = payload as { code: unknown; message?: unknown };
    return new NativeCallError(String(code), typeof message === "string" ? message : String(code));
  }
  return new NativeCallError("task-failed", String(payload));
}
