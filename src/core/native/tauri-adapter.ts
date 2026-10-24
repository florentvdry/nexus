import { invoke } from "@tauri-apps/api/core";

import { type LaunchOutcome, type NativeAdapter, type SystemInfo, toNativeCallError } from "./adapter";

export async function callNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (payload) {
    throw toNativeCallError(payload);
  }
}

export class TauriNativeAdapter implements NativeAdapter {
  systemInfo(): Promise<SystemInfo> {
    return callNative<SystemInfo>("system_info");
  }

  launchApp(name: string): Promise<LaunchOutcome> {
    return callNative<LaunchOutcome>("app_open", { name });
  }
}
