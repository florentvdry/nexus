
import { callNative } from "../native/tauri-adapter";
import { isDesktopRuntime, NativeUnavailableError } from "../native";
import type { ConnectorReport, ConnectorRequest, OsintRunner } from "./types";

/** Pont vers `osint_run` : le backend lance le worker isolé et renvoie le rapport normalisé. */
export class TauriOsintRunner implements OsintRunner {
  run(request: ConnectorRequest): Promise<ConnectorReport> {
    return callNative<ConnectorReport>("osint_run", { request });
  }
}

export class UnavailableOsintRunner implements OsintRunner {
  run(): Promise<ConnectorReport> {
    return Promise.reject(new NativeUnavailableError());
  }
}

export function createOsintRunner(): OsintRunner {
  return isDesktopRuntime() ? new TauriOsintRunner() : new UnavailableOsintRunner();
}

