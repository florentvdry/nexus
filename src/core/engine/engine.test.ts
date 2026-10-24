import { describe, expect, it, vi } from "vitest";

import { NativeCallError, NativeUnavailableError, type NativeAdapter, type SystemInfo } from "../native/adapter";
import { unavailableNativeAdapter } from "../native";
import { createEngine, type EngineEvent, type OrbState } from "./engine";
import { scriptedBridge, TEST_MODEL } from "../testing/scripted";

// Ce que le modèle local répond à chaque phrase de ces tests : la compréhension n'est plus une règle de texte.
const ANSWERS: Record<string, unknown> = {
  "Jarvis, lance Discord.": { type: "OPEN_APPLICATION", appName: "Discord" },
  "Open Notepad": { type: "OPEN_APPLICATION", appName: "Notepad" },
  "lance la calculatrice": { type: "OPEN_APPLICATION", appName: "calculatrice" },
  "lance Claude Code": { type: "OPEN_APPLICATION", appName: "Claude Code" },
  "lance Discord": { type: "OPEN_APPLICATION", appName: "Discord" },
  "Affiche l'utilisation CPU": { type: "SYSTEM_INFO" },
  "Ferme cette fenêtre": { type: "CLOSE_WINDOW" },
  "affiche les ressources de mon ordinateur": { type: "SYSTEM_INFO" },
  "annule la recherche": { type: "CANCEL_TASKS" },
  "quelle heure est-il sur la planète Mars": { type: "UNKNOWN", text: "quelle heure est-il sur la planète Mars" },
};

// Adaptateur natif SIMULÉ : réservé aux tests. Il ne représente pas la machine réelle.
const GiB = 1024 ** 3;
const fakeSystem: SystemInfo = {
  osName: "Windows 11 (simulé)",
  hostName: "TEST-PC",
  cpuBrand: "CPU de test",
  cpuCount: 8,
  cpuUsagePercent: 12,
  memoryTotalBytes: 16 * GiB,
  memoryUsedBytes: 4 * GiB,
  disks: [{ mountPoint: "C:\\", totalBytes: 512 * GiB, availableBytes: 200 * GiB }],
  uptimeSeconds: 3725,
};

function fakeNative(overrides: Partial<NativeAdapter> = {}): NativeAdapter {
  return {
    systemInfo: vi.fn(async () => fakeSystem),
    launchApp: vi.fn(async (appId: string) => ({ appId, displayName: appId, pid: 1234 })),
    listApps: vi.fn(async () => []),
    ...overrides,
  };
}

function setup(native: NativeAdapter, locale: "fr" | "en" = "fr") {
  const engine = createEngine({ native, bridge: scriptedBridge(ANSWERS), model: () => TEST_MODEL, locale, responseHoldMs: 0 });
  const events: EngineEvent[] = [];
  engine.subscribe((event) => events.push(event));
  return { engine, events };
}

const orbStates = (events: EngineEvent[]): OrbState[] =>
  events.flatMap((event) => (event.type === "orb" ? [event.state] : []));
const assistantTexts = (events: EngineEvent[]): string[] =>
  events.flatMap((event) => (event.type === "message" && event.role === "assistant" ? [event.text] : []));

describe("Engine — lancement d'application", () => {
  it("lance Discord, rend un message court et suit la tâche jusqu'à sa fin", async () => {
    const native = fakeNative();
    const { engine, events } = setup(native);

    await engine.submit("Jarvis, lance Discord.");

    expect(native.launchApp).toHaveBeenCalledWith("discord");
    expect(assistantTexts(events)).toEqual(["Discord est ouvert."]);
    expect(orbStates(events)).toEqual(expect.arrayContaining(["thinking", "executing", "responding"]));
    expect(engine.tasksSnapshot()[0]).toMatchObject({ labelKey: "task.openApp", state: "done", labelParams: { app: "Discord" } });
  });

  it("répond en anglais quand la langue de l'interface est l'anglais", async () => {
    const { engine, events } = setup(fakeNative(), "en");
    await engine.submit("Open Notepad");
    expect(assistantTexts(events)).toEqual(["Notepad is open."]);
  });

  it("signale une application absente avec une carte d'erreur, sans la masquer", async () => {
    const native = fakeNative({
      launchApp: vi.fn(async () => {
        throw new NativeCallError("not-installed", "application non installée : Calculatrice");
      }),
    });
    const { engine, events } = setup(native);

    await engine.submit("lance la calculatrice");

    expect(assistantTexts(events)).toEqual(["Calculatrice n'est pas installé sur cette machine."]);
    expect(events).toContainEqual(expect.objectContaining({ type: "present", content: expect.objectContaining({ kind: "error-card", code: "not-installed" }) }));
    expect(orbStates(events)).toContain("error");
    expect(engine.tasksSnapshot()[0]).toMatchObject({ state: "error", errorCode: "not-installed" });
  });

  it("n'appelle jamais le système pour une application inconnue", async () => {
    const native = fakeNative();
    const { events } = setup(native);

    await setup(native).engine.submit("lance Claude Code");
    expect(native.launchApp).not.toHaveBeenCalled();
    expect(events.length).toBe(0);
  });

  it("explique honnêtement l'absence du backend natif hors application de bureau", async () => {
    const { engine, events } = setup(unavailableNativeAdapter);
    await engine.submit("lance Discord");
    expect(assistantTexts(events)[0]).toContain("application de bureau NEXUS");
    expect(events).toContainEqual(expect.objectContaining({ type: "present", content: expect.objectContaining({ code: "native-unavailable" }) }));
    expect(new NativeUnavailableError().name).toBe("NativeUnavailableError");
  });
});

describe("Engine — informations système", () => {
  it("produit une carte de ressources et un tableau des disques", async () => {
    const { engine, events } = setup(fakeNative());
    await engine.submit("Affiche l'utilisation CPU");

    const presented = events.flatMap((event) => (event.type === "present" ? [event.content] : []));
    expect(presented.map((content) => content.kind)).toEqual(["information-card", "data-table"]);
    expect(assistantTexts(events)).toEqual(["Processeur à 12 %, mémoire utilisée à 25 %."]);
    expect(engine.tasksSnapshot()[0].state).toBe("done");
  });
});

describe("Engine — commandes de contrôle", () => {
  it("demande la fermeture de la dernière fenêtre", async () => {
    const { engine, events } = setup(fakeNative());
    await engine.submit("Ferme cette fenêtre");
    expect(events).toContainEqual({ type: "window-command", command: "close-last" });
  });

  it("annule une tâche en cours et signale l'annulation", async () => {
    const native = fakeNative({ systemInfo: vi.fn(() => new Promise<SystemInfo>(() => {})) });
    const { engine, events } = setup(native);

    const running = engine.submit("affiche les ressources de mon ordinateur");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await engine.submit("annule la recherche");
    await running;

    expect(engine.tasksSnapshot()[0].state).toBe("cancelled");
    expect(assistantTexts(events)).toEqual(["1 tâche(s) annulée(s).", "Opération annulée."]);
  });

  it("répond clairement à une phrase qu'il ne comprend pas, sans appel externe", async () => {
    const native = fakeNative();
    const { engine, events } = setup(native);
    await engine.submit("quelle heure est-il sur la planète Mars");
    expect(assistantTexts(events)[0]).toContain("Je n'ai pas compris");
    expect(native.systemInfo).not.toHaveBeenCalled();
  });
});
