import { invoke } from "@tauri-apps/api/core";

import { type AppStatus, type LaunchOutcome, type NativeAdapter, type SystemInfo, toNativeCallError } from "./adapter";

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

  launchApp(appId: string): Promise<LaunchOutcome> {
    return callNative<LaunchOutcome>("launch_app", { appId });
  }

  listApps(): Promise<AppStatus[]> {
    return callNative<AppStatus[]>("list_apps");
  }
}
