import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriNativeBridge } from "./bridge";

const callNative = vi.fn(async (_command: string, _args?: Record<string, unknown>) => undefined as never);

vi.mock("./tauri-adapter", () => ({
  callNative: (command: string, args?: Record<string, unknown>) => callNative(command, args),
}));

describe("pont natif attribué", () => {
  beforeEach(() => callNative.mockClear());

  it("transmet l'identité du plugin à chaque appel, pour que le natif vérifie sa permission", async () => {
    await new TauriNativeBridge().forPlugin("actions.process-list").listProcesses(3);
    expect(callNative).toHaveBeenCalledWith("processes_list", { caller: "actions.process-list", limit: 3 });
  });

  it("transmet l'identité de l'interface pour les réponses aux confirmations", async () => {
    await new TauriNativeBridge().answerConfirmation("perm-1", true);
    expect(callNative).toHaveBeenCalledWith("permission_answer", { caller: "core", id: "perm-1", approved: true });
  });

  it("réserve le journal à l'interface : ses appels portent l'identité de l'interface", async () => {
    await new TauriNativeBridge().recordJournal("HELP", "aide");
    expect(callNative).toHaveBeenCalledWith("journal_record", { caller: "core", kind: "HELP", text: "aide" });
  });

  it("n'altère pas le pont de l'interface quand un plugin en dérive un autre", async () => {
    const core = new TauriNativeBridge();
    core.forPlugin("agents.claude-code");
    await core.closeWindow(42);
    expect(callNative).toHaveBeenCalledWith("window_close", { caller: "core", id: 42 });
  });
});
