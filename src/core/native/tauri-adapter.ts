import { invoke } from "@tauri-apps/api/core";

import { type AppStatus, type LaunchOutcome, type NativeAdapter, type SystemInfo, toNativeCallError } from "./adapter";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (payload) {
    throw toNativeCallError(payload);
  }
}

export class TauriNativeAdapter implements NativeAdapter {
  systemInfo(): Promise<SystemInfo> {
    return call<SystemInfo>("system_info");
  }

  launchApp(appId: string): Promise<LaunchOutcome> {
    return call<LaunchOutcome>("launch_app", { appId });
  }

  listApps(): Promise<AppStatus[]> {
    return call<AppStatus[]>("list_apps");
  }
}
