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

/** Application trouvée sur le PC par le scan, puis lancée : son nom tel que Windows l'affiche. */
export interface LaunchOutcome {
  displayName: string;
}

export interface NativeAdapter {
  systemInfo(): Promise<SystemInfo>;
  /** Cherche l'application par son nom sur ce PC, puis la lance. Une application absente : `not-installed`. */
  launchApp(name: string): Promise<LaunchOutcome>;
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
