import { NativeUnavailableError, type NativeAdapter } from "./adapter";
import { TauriNativeAdapter } from "./tauri-adapter";

export * from "./adapter";

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Hors application de bureau, chaque appel échoue explicitement : aucune donnée n'est simulée. */
export const unavailableNativeAdapter: NativeAdapter = {
  systemInfo: () => Promise.reject(new NativeUnavailableError()),
  launchApp: () => Promise.reject(new NativeUnavailableError()),
  listApps: () => Promise.reject(new NativeUnavailableError()),
};

export function createNativeAdapter(): NativeAdapter {
  return isDesktopRuntime() ? new TauriNativeAdapter() : unavailableNativeAdapter;
}
