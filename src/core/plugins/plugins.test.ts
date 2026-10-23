import { describe, expect, it, vi } from "vitest";

import { createEngine } from "../engine/engine";
import { NativeCallError } from "../native/adapter";
import { activatePlugin, validateManifest } from "./host";
import { discoverBuiltinPlugins, loadBuiltinPlugins } from "./builtin";
import { API_VERSION, type DiscoveredPlugin, type PluginApi, type PluginManifest } from "./types";
import { registeredApplications, registerApplications, registerLanguageDictionary } from "../intent/registry";

const manifest = (overrides: Partial<PluginManifest> = {}): PluginManifest => ({
  id: "actions.demo",
  name: "Démo",
  version: "1.0.0",
  apiVersion: API_VERSION,
  type: "actions",
  description: "Plugin de test",
  author: "test",
  license: "MIT",
  entry: "index.ts",
  native: [],
  capabilities: ["demo.run"],
  connectors: [],
  languages: [],
  applications: false,
  permissions: ["system.read"],
  locality: "local",
  cost: "local",
  offline: true,
  ...overrides,
});

const noopApi = (): PluginApi => ({
  registerCapability: vi.fn(),
  registerLanguage: vi.fn(),
  registerApplications: vi.fn(),
});

describe("plugins livrés", () => {
  it("découvre un dossier par plugin, rangé par type", () => {
    const folders = discoverBuiltinPlugins().map((plugin) => plugin.folder);
    expect(folders).toEqual([
      "actions/app-launch",
      "actions/file-operations",
      "actions/file-search",
      "actions/plugin-manager",
      "actions/process-list",
      "actions/system-info",
      "actions/window-control",
      "agents/claude-code",
      "documents/file-inspect",
      "languages/en",
      "languages/fr",
      "sources/domain-analysis",
      "sources/username-search",
      "speech/system-tts",
      "speech/whisper-stt",
    ]);
  });

  it("active chaque plugin livré sans erreur", () => {
    const statuses = loadBuiltinPlugins(noopApi());
    expect(statuses.filter((status) => status.state === "failed")).toEqual([]);
  });

  it("un moteur neuf charge les plugins et expose leur état", () => {
    const engine = createEngine({ native: { systemInfo: vi.fn(), launchApp: vi.fn(), listApps: vi.fn(async () => []) }, locale: "fr", responseHoldMs: 0 });
    expect(engine.plugins.every((plugin) => plugin.state === "active")).toBe(true);
    expect(registeredApplications().map((app) => app.id)).toContain("discord");
  });

  it("le catalogue d'applications et les langues viennent des plugins, pas du noyau", () => {
    loadBuiltinPlugins(noopApi());
    expect(registeredApplications().length).toBeGreaterThan(0);
  });
});

describe("validation des manifestes", () => {
  it("accepte un manifeste cohérent avec son dossier", () => {
    expect(validateManifest(manifest(), "actions/demo")).toEqual([]);
  });

  it("refuse un type ou un identifiant qui ne correspond pas au dossier", () => {
    const problems = validateManifest(manifest({ type: "sources", id: "actions.autre" }), "actions/demo");
    expect(problems.join(" ")).toContain("déclaré dans un dossier");
    expect(problems.join(" ")).toContain("identifiant attendu « actions.demo »");
  });

  it("refuse une API inconnue, une permission inconnue et une version invalide", () => {
    const problems = validateManifest(manifest({ apiVersion: 99, permissions: ["root.all"], version: "1" }), "actions/demo");
    expect(problems).toHaveLength(3);
  });
});

describe("activation isolée", () => {
  const plugin = (activate: (api: PluginApi) => void, overrides: Partial<PluginManifest> = {}): DiscoveredPlugin => ({
    folder: "actions/demo",
    manifest: manifest(overrides),
    module: { activate },
  });

  it("ne laisse enregistrer que ce que le manifeste déclare", () => {
    const api = noopApi();
    const status = activatePlugin(
      plugin((host) => host.registerCapability({ id: "demo.autre" } as never, async () => {
        throw new Error("jamais appelé");
      })),
      api,
    );
    expect(status.state).toBe("failed");
    expect(status.error).toContain("capacité non déclarée : demo.autre");
    expect(api.registerCapability).not.toHaveBeenCalled();
  });

  it("confine l'erreur d'un plugin : les autres continuent de se charger", () => {
    const api = noopApi();
    const broken = activatePlugin(plugin(() => {
      throw new Error("bug du plugin");
    }), api);
    const healthy = activatePlugin({ ...plugin(() => {}), folder: "actions/sain", manifest: manifest({ id: "actions.sain" }) }, api);
    expect(broken).toMatchObject({ state: "failed", error: "bug du plugin" });
    expect(healthy.state).toBe("active");
  });

  it("donne à chaque capacité un pont attribué à son plugin", async () => {
    const api = noopApi();
    const scoped = { marker: "pont attribué" } as never;
    const forPlugin = vi.fn(() => scoped);
    const inner = vi.fn(async () => ({ caption: "ok", presentations: [], source: { capabilityId: "demo.liste", locality: "local" as const, collectedAt: 0 } }));
    const status = activatePlugin(plugin((host) => host.registerCapability({ id: "demo.liste" } as never, inner), { capabilities: ["demo.liste"] }), api);
    expect(status.state).toBe("active");

    const registered = vi.mocked(api.registerCapability).mock.calls[0][1];
    await registered({}, { bridge: { forPlugin } } as never);
    expect(forPlugin).toHaveBeenCalledWith("actions.demo");
    expect(inner).toHaveBeenCalledWith({}, expect.objectContaining({ bridge: scoped }));
  });

  it("refuse un catalogue d'applications non déclaré dans le manifeste", () => {
    const status = activatePlugin(plugin((host) => host.registerApplications([])), noopApi());
    expect(status.error).toContain("catalogue d'applications non déclaré");
  });

  it("refuse une langue non déclarée", () => {
    const status = activatePlugin(plugin((host) => host.registerLanguage("de", {} as never)), noopApi());
    expect(status.error).toContain("langue non déclarée : de");
  });

  it("garde la référence des erreurs natives pour l'affichage", () => {
    expect(new NativeCallError("not-installed", "x").code).toBe("not-installed");
  });
});

describe("registre des données de plugins", () => {
  it("remplace le catalogue au lieu de le cumuler", () => {
    registerApplications([{ id: "a", nameKey: "app.Notepad", aliases: ["a"] }]);
    registerApplications([{ id: "b", nameKey: "app.Notepad", aliases: ["b"] }]);
    expect(registeredApplications().map((app) => app.id)).toEqual(["b"]);
    registerLanguageDictionary("test", { openVerbs: [], closeAll: [], closeWindow: [], cancelTasks: [], systemInfo: [], help: [], fillerWords: /$^/ });
  });
});
