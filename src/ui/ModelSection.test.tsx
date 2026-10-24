// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HardwareProfile } from "../core/language-model/hardware";
import type { OllamaStatus } from "../core/language-model/ollama";
import type { NativeBridge } from "../core/native/bridge";
import { translate } from "../i18n/messages";
import { ModelSection } from "./ModelSection";

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate("fr", key, params);

const machine: HardwareProfile = { memoryGiB: 16, cores: 8, avx2: true, gpu: null };
const installed = (name: string) => ({ name, sizeBytes: 4_700_000_000, parameterSize: "7.6B" });

function bridgeWith(status: OllamaStatus | Error, profile: HardwareProfile = machine) {
  return {
    ollamaStatus: vi.fn(async () => {
      if (status instanceof Error) throw status;
      return status;
    }),
    hardwareProfile: vi.fn(async () => profile),
  } as unknown as NativeBridge;
}

describe("modèle de langage dans les réglages", () => {
  beforeEach(() => window.localStorage.removeItem("nexus.model.selected"));
  afterEach(cleanup);

  it("affiche qu'aucun modèle n'est utilisé tant que l'utilisateur n'en choisit pas", async () => {
    render(<ModelSection bridge={bridgeWith({ reachable: true, models: [installed("qwen2.5:7b")] })} t={t} />);
    expect(await screen.findByText("Modèle utilisé : aucun, NEXUS utilise les règles seules.")).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Aucun (règles seules)" }) as HTMLInputElement).checked).toBe(true);
  });

  it("liste les modèles installés et signale le recommandé sans l'imposer", async () => {
    render(<ModelSection bridge={bridgeWith({ reachable: true, models: [installed("qwen2.5:14b"), installed("llama3:8b")] })} t={t} />);
    const recommended = await screen.findByRole("radio", { name: /qwen2\.5:14b.*recommandé/ });
    expect((recommended as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("radio", { name: /llama3:8b/ })).toBeTruthy();
    expect(window.localStorage.getItem("nexus.model.selected")).toBeNull();
  });

  it("enregistre le modèle choisi et l'affiche comme modèle utilisé", async () => {
    render(<ModelSection bridge={bridgeWith({ reachable: true, models: [installed("llama3:8b")] })} t={t} />);
    fireEvent.click(await screen.findByRole("radio", { name: /llama3:8b/ }));
    expect(window.localStorage.getItem("nexus.model.selected")).toBe("llama3:8b");
    expect(await screen.findByText("Modèle utilisé : llama3:8b")).toBeTruthy();
  });

  it("donne la commande pour installer le modèle recommandé quand il manque", async () => {
    render(<ModelSection bridge={bridgeWith({ reachable: true, models: [installed("llama3:8b")] })} t={t} />);
    await waitFor(() => expect(screen.getByText("qwen2.5:14b", { exact: false })).toBeTruthy());
    expect(screen.getByText("ollama pull qwen2.5:14b")).toBeTruthy();
  });

  it("relit le modèle choisi quand le parcours le change, sans rouvrir les réglages", async () => {
    const bridge = bridgeWith({ reachable: true, models: [installed("llama3:8b")] });
    const { rerender } = render(<ModelSection bridge={bridge} t={t} revision={0} />);
    expect(await screen.findByText("Modèle utilisé : aucun, NEXUS utilise les règles seules.")).toBeTruthy();
    window.localStorage.setItem("nexus.model.selected", "llama3:8b");
    rerender(<ModelSection bridge={bridge} t={t} revision={1} />);
    expect(await screen.findByText("Modèle utilisé : llama3:8b")).toBeTruthy();
  });

  it("dit clairement quand Ollama ne répond pas, sans inventer de modèle", async () => {
    render(<ModelSection bridge={bridgeWith({ reachable: false, models: [] })} t={t} />);
    expect(await screen.findByText(/Ollama ne répond pas sur ce poste/)).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /qwen/ })).toBeNull();
  });
});
