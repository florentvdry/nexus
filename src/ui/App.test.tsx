// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createEngine } from "../core/engine/engine";
import { scriptedBridge, TEST_MODEL } from "../core/testing/scripted";
import { NativeCallError, type NativeAdapter } from "../core/native/adapter";
import { unavailableNativeAdapter } from "../core/native";
import { App } from "./App";


// Réponses du modèle local simulé, pour les phrases envoyées dans la barre de commande.
const APP_ANSWERS: Record<string, unknown> = {
  "Jarvis, lance Discord.": { type: "OPEN_APPLICATION", appName: "Discord" },
  "Affiche les informations de mon ordinateur": { type: "SYSTEM_INFO" },
  "lance la calculatrice": { type: "OPEN_APPLICATION", appName: "calculatrice" },
  "lance discord": { type: "OPEN_APPLICATION", appName: "Discord" },
};

// Adaptateur natif SIMULÉ, réservé aux tests d'interface.
const GiB = 1024 ** 3;

function simulatedNative(overrides: Partial<NativeAdapter> = {}): NativeAdapter {
  return {
    systemInfo: vi.fn(async () => ({
      osName: "Windows 11 (simulé)",
      hostName: "TEST-PC",
      cpuBrand: "CPU de test",
      cpuCount: 8,
      cpuUsagePercent: 12,
      memoryTotalBytes: 16 * GiB,
      memoryUsedBytes: 4 * GiB,
      disks: [],
      uptimeSeconds: 3600,
    })),
    launchApp: vi.fn(async (name: string) => ({ displayName: name })),
    ...overrides,
  };
}

function send(text: string) {
  const input = screen.getByLabelText("Dis-moi ce que tu veux faire…");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

beforeAll(() => {
  // jsdom ne fournit pas de contexte 2D : l'orbe reste inactive dans les tests.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  // Le parcours de premier lancement déjà vu : il ne masque pas les autres tests.
  window.localStorage.setItem("nexus.modelSetup.seen", "1");
  // La première conversation déjà faite : elle ne pose pas ses questions pendant les tests.
  window.localStorage.setItem("nexus.firstConversation.done", "1");
});

afterEach(() => cleanup());

describe("App", () => {
  it("au premier lancement, le parcours bloque l'application : pas de « Passer », rien n'est marqué vu", async () => {
    window.localStorage.removeItem("nexus.modelSetup.seen");
    render(<App engine={createEngine({ bridge: scriptedBridge(APP_ANSWERS), model: () => TEST_MODEL, native: simulatedNative(), locale: "fr", responseHoldMs: 0 })} />);

    expect(screen.getByRole("dialog", { name: "Configuration du modèle local" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Passer" })).toBeNull();
    expect(window.localStorage.getItem("nexus.modelSetup.seen")).toBeNull();
    window.localStorage.setItem("nexus.modelSetup.seen", "1");
  });

  it("lance une application depuis la barre de commande et affiche la réponse courte", async () => {
    const native = simulatedNative();
    render(<App engine={createEngine({ bridge: scriptedBridge(APP_ANSWERS), model: () => TEST_MODEL, native, locale: "fr", responseHoldMs: 0 })} />);

    expect(screen.getByText(/Je suis prêt/)).toBeTruthy();
    send("Jarvis, lance Discord.");

    await waitFor(() => expect(screen.getByText("Discord est ouvert.")).toBeTruthy());
    expect(native.launchApp).toHaveBeenCalledWith("Discord");
    expect(screen.getByText("Tâches")).toBeTruthy();
  });

  it("affiche les ressources système dans une fenêtre flottante, puis la ferme", async () => {
    render(<App engine={createEngine({ bridge: scriptedBridge(APP_ANSWERS), model: () => TEST_MODEL, native: simulatedNative(), locale: "fr", responseHoldMs: 0 })} />);

    send("Affiche les informations de mon ordinateur");
    await waitFor(() => expect(screen.getByText("Ressources système")).toBeTruthy());
    expect(screen.getByText("Processeur à 12 %, mémoire utilisée à 25 %.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByText("Ressources système")).toBeNull());
  });

  it("montre une carte d'erreur explicite quand l'application est absente", async () => {
    const native = simulatedNative({
      launchApp: vi.fn(async () => {
        throw new NativeCallError("not-installed", "application non installée : Calculatrice");
      }),
    });
    render(<App engine={createEngine({ bridge: scriptedBridge(APP_ANSWERS), model: () => TEST_MODEL, native, locale: "fr", responseHoldMs: 0 })} />);

    send("lance la calculatrice");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("calculatrice n'est pas installé"));
  });

  it("signale honnêtement l'absence du backend natif hors application de bureau", async () => {
    render(<App engine={createEngine({ bridge: scriptedBridge(APP_ANSWERS), model: () => TEST_MODEL, native: unavailableNativeAdapter, locale: "fr", responseHoldMs: 0 })} />);

    send("lance discord");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("application de bureau NEXUS"));
  });

  it("bascule la langue de l'interface", () => {
    render(<App engine={createEngine({ bridge: scriptedBridge(APP_ANSWERS), model: () => TEST_MODEL, native: simulatedNative(), locale: "fr", responseHoldMs: 0 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Langue" }));
    expect(screen.getByPlaceholderText("Tell me what you want to do…")).toBeTruthy();
  });

  it("affiche le micro et signale honnêtement l'absence du backend vocal", async () => {
    render(<App engine={createEngine({ bridge: scriptedBridge(APP_ANSWERS), model: () => TEST_MODEL, native: simulatedNative(), locale: "fr", responseHoldMs: 0 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Démarrer l'écoute" }));
    await waitFor(() => expect(screen.getByText(/application de bureau NEXUS/)).toBeTruthy());
  });

  it("ouvre le panneau de réglages vocaux", () => {
    render(<App engine={createEngine({ bridge: scriptedBridge(APP_ANSWERS), model: () => TEST_MODEL, native: simulatedNative(), locale: "fr", responseHoldMs: 0 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Réglages" }));
    expect(screen.getByRole("heading", { name: "Réglages vocaux" })).toBeTruthy();
    expect(screen.getByLabelText("Fonctions vocales activées")).toBeTruthy();
  });
});
