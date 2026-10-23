// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createEngine } from "../core/engine/engine";
import { NativeCallError, type NativeAdapter } from "../core/native/adapter";
import { unavailableNativeAdapter } from "../core/native";
import { App } from "./App";

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
    launchApp: vi.fn(async (appId: string) => ({ appId, displayName: appId, pid: 1 })),
    listApps: vi.fn(async () => []),
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
});

afterEach(() => cleanup());

describe("App", () => {
  it("lance une application depuis la barre de commande et affiche la réponse courte", async () => {
    const native = simulatedNative();
    render(<App engine={createEngine({ native, locale: "fr", responseHoldMs: 0 })} />);

    expect(screen.getByText(/Je suis prêt/)).toBeTruthy();
    send("Jarvis, lance Discord.");

    await waitFor(() => expect(screen.getByText("Discord est ouvert.")).toBeTruthy());
    expect(native.launchApp).toHaveBeenCalledWith("discord");
    expect(screen.getByText("Tâches")).toBeTruthy();
  });

  it("affiche les ressources système dans une fenêtre flottante, puis la ferme", async () => {
    render(<App engine={createEngine({ native: simulatedNative(), locale: "fr", responseHoldMs: 0 })} />);

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
    render(<App engine={createEngine({ native, locale: "fr", responseHoldMs: 0 })} />);

    send("lance la calculatrice");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Calculatrice n'est pas installé"));
  });

  it("signale honnêtement l'absence du backend natif hors application de bureau", async () => {
    render(<App engine={createEngine({ native: unavailableNativeAdapter, locale: "fr", responseHoldMs: 0 })} />);

    send("lance discord");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("application de bureau NEXUS"));
  });

  it("bascule la langue de l'interface", () => {
    render(<App engine={createEngine({ native: simulatedNative(), locale: "fr", responseHoldMs: 0 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Langue" }));
    expect(screen.getByPlaceholderText("Tell me what you want to do…")).toBeTruthy();
  });
});
