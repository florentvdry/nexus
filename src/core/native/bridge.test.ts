import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriNativeBridge } from "./bridge";

const callNative = vi.fn(async (_command: string, _args?: Record<string, unknown>) => undefined as never);

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("./tauri-adapter", () => ({
  callNative: (command: string, args?: Record<string, unknown>) => callNative(command, args),
}));

describe("pont natif attribué", () => {
  beforeEach(() => callNative.mockClear());

  it("transmet l'identité du plugin à chaque appel, pour que le natif vérifie sa permission", async () => {
    await new TauriNativeBridge().listProcesses(3);
    expect(callNative).toHaveBeenCalledWith("processes_list", { limit: 3 });
  });

  it("transmet l'identité de l'interface pour les réponses aux confirmations", async () => {
    await new TauriNativeBridge().answerConfirmation("perm-1", true);
    expect(callNative).toHaveBeenCalledWith("permission_answer", { id: "perm-1", approved: true, remember: false });
  });

  it("transmet « toujours autoriser » au natif quand l'utilisateur coche la case", async () => {
    await new TauriNativeBridge().answerConfirmation("perm-2", true, true);
    expect(callNative).toHaveBeenCalledWith("permission_answer", { id: "perm-2", approved: true, remember: true });
  });

  it("envoie la demande et le modèle choisi au classement local, au nom de l'interface", async () => {
    await new TauriNativeBridge().classifyIntent("ouvre la calculatrice", "qwen2.5:7b");
    expect(callNative).toHaveBeenLastCalledWith("model_classify", { text: "ouvre la calculatrice", model: "qwen2.5:7b", memories: [] });
  });

  it("télécharge un modèle au nom de l'interface, en écoutant sa progression", async () => {
    await new TauriNativeBridge().pullModel("qwen2.5:1.5b", () => {});
    expect(callNative).toHaveBeenLastCalledWith("ollama_pull", { model: "qwen2.5:1.5b" });
  });

  it("installe Ollama au nom de l'interface, après accord", async () => {
    await new TauriNativeBridge().installOllama(() => {});
    expect(callNative).toHaveBeenLastCalledWith("ollama_install", {});
  });

  it("lit l'état d'Ollama au nom de l'interface", async () => {
    await new TauriNativeBridge().ollamaStatus();
    expect(callNative).toHaveBeenLastCalledWith("ollama_status", {});
  });

  it("lit le profil de la machine au nom de l'interface", async () => {
    await new TauriNativeBridge().hardwareProfile();
    expect(callNative).toHaveBeenLastCalledWith("hardware_profile", {});
  });

  it("lit, révoque et journalise les autorisations mémorisées au nom de l'interface", async () => {
    const bridge = new TauriNativeBridge();
    await bridge.listRules();
    expect(callNative).toHaveBeenLastCalledWith("permission_rules", {});
    await bridge.revokeRule("rule-1");
    expect(callNative).toHaveBeenLastCalledWith("permission_revoke", { id: "rule-1" });
    await bridge.listAudit();
    expect(callNative).toHaveBeenLastCalledWith("permission_audit", {});
  });

  it("réserve le journal à l'interface : ses appels portent l'identité de l'interface", async () => {
    await new TauriNativeBridge().recordJournal("HELP", "aide");
    expect(callNative).toHaveBeenCalledWith("journal_record", { kind: "HELP", text: "aide" });
  });

  it("confie l'installation de plugin à l'identité du gestionnaire de plugins uniquement", async () => {
    await new TauriNativeBridge().pluginRemove("community.ana.verbes");
    expect(callNative).toHaveBeenCalledWith("plugin_remove", { id: "community.ana.verbes" });
  });

  it("exécute une commande de plugin au nom de l'interface, jamais au nom du plugin lui-même", async () => {
    await new TauriNativeBridge().pluginRun("community.exemple.convertisseur", "convertit", "1 km en mi");
    expect(callNative).toHaveBeenCalledWith("plugin_run", {
      pluginId: "community.exemple.convertisseur",
      command: "convertit",
      text: "1 km en mi",
    });
  });

  it("n'envoie jamais d'identité : aucun appel ne porte de champ caller, ce que le JavaScript prétendrait être", async () => {
    const bridge = new TauriNativeBridge();
    await bridge.closeWindow(42);
    await bridge.listProcesses(3);
    await bridge.answerConfirmation("perm-9", false);
    for (const [, args] of vi.mocked(callNative).mock.calls) {
      expect(args).not.toHaveProperty("caller");
    }
  });
});
