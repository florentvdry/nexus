import { describe, expect, it, vi } from "vitest";

import { translate } from "../../i18n/messages";
import { ConnectorFlow, parseSelection, searchTerm, type ConnectorBridge } from "./flow";
import type { ConnectorCandidate, InstalledConnector } from "./types";

const candidate: ConnectorCandidate = {
  id: "app.example/discord",
  title: "discord",
  description: "Discord",
  repository: "https://github.com/acme/discord-mcp",
  stars: 120,
  package: "@acme/discord-mcp",
  version: "1.2.0",
  env: [{ name: "DISCORD_BOT_TOKEN", required: true, secret: true, description: "" }],
};

const installed = (isSet: boolean): InstalledConnector => ({
  id: candidate.id,
  title: candidate.title,
  scopes: ["read"],
  package: candidate.package,
  version: candidate.version,
  variables: [{ ...candidate.env[0], isSet }],
});

const tools = [{ name: "send_message", description: "Envoie un message", inputSchema: { type: "object" } }];

/** Pont simulé : aucune installation ni appel réel. */
function fakeBridge(overrides: Partial<ConnectorBridge> = {}): ConnectorBridge {
  return {
    mcpSearch: vi.fn(async () => [candidate]),
    mcpInstalled: vi.fn(async () => [installed(true)]),
    mcpInstall: vi.fn(async () => installed(false)),
    mcpSetValue: vi.fn(async () => {}),
    mcpTools: vi.fn(async () => tools),
    mcpCall: vi.fn(async () => "message envoyé"),
    modelJson: vi.fn(async () => ({ tool: "send_message", arguments: { channel: "Anthony", content: "Je t'attends" } })),
    ...overrides,
  };
}

function setup(bridge: ConnectorBridge, model: string | null = "qwen2.5:7b") {
  const said: string[] = [];
  const flow = new ConnectorFlow({
    bridge,
    model: () => model,
    say: (text) => said.push(text),
    t: (key, params) => translate("fr", key, params),
  });
  return { flow, said };
}

describe("terme de recherche", () => {
  it("garde le nom du service et retire la ponctuation", () => {
    expect(searchTerm("Discord", "envoyer un message")).toBe("Discord");
    expect(searchTerm(undefined, "envoie à Anthony : « je t'attends » !")).toBe("envoie à Anthony je t attends");
  });

  it("borne la longueur du terme", () => {
    expect(searchTerm("x".repeat(200), "")).toHaveLength(60);
  });
});

describe("sélection de l'outil par le modèle", () => {
  it("accepte un outil de la liste avec des arguments en objet", () => {
    expect(parseSelection({ tool: "send_message", arguments: { channel: "a" } }, tools)).toEqual({ tool: "send_message", args: { channel: "a" } });
  });

  it("refuse un outil absent de la liste, des arguments qui ne sont pas un objet, ou une réponse vide", () => {
    expect(parseSelection({ tool: "delete_everything", arguments: {} }, tools)).toBeNull();
    expect(parseSelection({ tool: "send_message", arguments: ["x"] }, tools)).toBeNull();
    expect(parseSelection({ tool: null }, tools)).toBeNull();
    expect(parseSelection("send_message", tools)).toBeNull();
  });
});

describe("parcours d'installation", () => {
  it("ne propose rien d'autre que le connecteur trouvé, et n'installe pas sans réponse", async () => {
    const bridge = fakeBridge();
    const { flow, said } = setup(bridge);
    await flow.start("envoie un message à Anthony", "Discord");
    expect(said[0]).toContain("discord");
    expect(said[0]).toContain("120");
    expect(bridge.mcpInstall).not.toHaveBeenCalled();
  });

  it("annonce qu'aucun connecteur n'existe quand la recherche est vide", async () => {
    const bridge = fakeBridge({ mcpSearch: vi.fn(async () => []) });
    const { flow, said } = setup(bridge);
    await flow.start("envoie un message", "Telegram");
    expect(said[0]).toContain("Telegram");
  });

  it("installe après « oui », puis choisit l'outil et attend la confirmation avant d'appeler", async () => {
    const bridge = fakeBridge({ mcpInstall: vi.fn(async () => installed(true)) });
    const { flow, said } = setup(bridge);
    await flow.start("envoie un message à Anthony", "Discord");
    expect(await flow.consume("oui")).toBe(true);
    expect(bridge.mcpInstall).toHaveBeenCalledWith(candidate.id);
    expect(bridge.mcpCall).not.toHaveBeenCalled();
    expect(said.at(-1)).toContain("send_message");
    expect(await flow.consume("oui")).toBe(true);
    expect(bridge.mcpCall).toHaveBeenCalledWith(candidate.id, "send_message", { channel: "Anthony", content: "Je t'attends" });
    expect(said.at(-1)).toContain("message envoyé");
  });

  it("n'appelle jamais l'outil après « non »", async () => {
    const bridge = fakeBridge();
    const { flow, said } = setup(bridge);
    await flow.start("envoie un message", "Discord");
    await flow.consume("non");
    expect(bridge.mcpInstall).not.toHaveBeenCalled();
    expect(said.at(-1)).toContain("rien n'a été");
  });

  it("une saisie sans rapport avec l'étape est une nouvelle demande : l'étape est abandonnée", async () => {
    const bridge = fakeBridge();
    const { flow } = setup(bridge);
    await flow.start("envoie un message", "Discord");
    expect(await flow.consume("quelle heure est-il ?")).toBe(false);
    expect(await flow.consume("oui")).toBe(false);
    expect(bridge.mcpInstall).not.toHaveBeenCalled();
  });

  it("demande la variable requise, la sauvegarde sans la réafficher, puis continue", async () => {
    const bridge = fakeBridge({ mcpInstall: vi.fn(async () => installed(false)), mcpInstalled: vi.fn(async () => [installed(true)]) });
    const { flow, said } = setup(bridge);
    await flow.start("envoie un message", "Discord");
    await flow.consume("oui");
    expect(flow.awaitsSecret).toBe(true);
    expect(said.at(-1)).toContain("DISCORD_BOT_TOKEN");
    await flow.consume("jeton-secret");
    expect(bridge.mcpSetValue).toHaveBeenCalledWith(candidate.id, "DISCORD_BOT_TOKEN", "jeton-secret");
    expect(flow.awaitsSecret).toBe(false);
    expect(said.some((line) => line.includes("jeton-secret"))).toBe(false);
  });

  it("sans modèle prêt, rien n'est choisi ni appelé", async () => {
    const bridge = fakeBridge({ mcpInstall: vi.fn(async () => installed(true)) });
    const { flow, said } = setup(bridge, null);
    await flow.start("envoie un message", "Discord");
    await flow.consume("oui");
    expect(bridge.mcpTools).not.toHaveBeenCalled();
    expect(said.at(-1)).toContain("modèle local");
  });

  it("une réponse du modèle hors de la liste d'outils ne déclenche aucun appel", async () => {
    const bridge = fakeBridge({ mcpInstall: vi.fn(async () => installed(true)), modelJson: vi.fn(async () => ({ tool: "rm_rf", arguments: {} })) });
    const { flow, said } = setup(bridge);
    await flow.start("envoie un message", "Discord");
    await flow.consume("oui");
    expect(said.at(-1)).toContain("Aucun outil");
    expect(bridge.mcpCall).not.toHaveBeenCalled();
  });
});
