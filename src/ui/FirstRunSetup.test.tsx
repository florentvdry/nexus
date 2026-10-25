// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { HardwareProfile } from "../core/language-model/hardware";
import type { NativeBridge } from "../core/native/bridge";
import { translate } from "../i18n/messages";
import { FirstRunSetup } from "./FirstRunSetup";

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate("fr", key, params);

const machine: HardwareProfile = { memoryGiB: 16, cores: 8, avx2: true, gpu: null };

function bridgeReturning(profile: HardwareProfile | Error) {
  return {
    hardwareProfile: vi.fn(async () => {
      if (profile instanceof Error) throw profile;
      return profile;
    }),
  } as unknown as NativeBridge;
}

describe("parcours de premier lancement", () => {
  beforeAll(() => {
    // jsdom ne fournit pas de contexte 2D : l'orbe reste inactive dans les tests.
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  });

  afterEach(cleanup);

  it("lit le profil de la machine et l'affiche à la première étape", async () => {
    render(<FirstRunSetup bridge={bridgeReturning(machine)} t={t} onClose={vi.fn()} />);
    expect(await screen.findByText("16.0 Go")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("non détectée")).toBeTruthy();
  });

  it("dit honnêtement quand la machine ne peut pas être lue", async () => {
    render(<FirstRunSetup bridge={bridgeReturning(new Error("indisponible"))} t={t} onClose={vi.fn()} />);
    expect(await screen.findByText("Cette information n'est pas disponible sur cette installation.")).toBeTruthy();
  });

  it("ne propose ni « Passer » ni fermeture : l'application reste bloquée tant que ce n'est pas prêt", async () => {
    render(<FirstRunSetup bridge={bridgeReturning(machine)} t={t} onClose={vi.fn()} />);
    await screen.findByText("16.0 Go");
    expect(screen.queryByRole("button", { name: "Passer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fermer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "×" })).toBeNull();
  });

  it("ne montre « Commencer » qu'une fois le modèle prêt", async () => {
    render(<FirstRunSetup bridge={bridgeReturning(machine)} t={t} onClose={vi.fn()} />);
    await screen.findByText("16.0 Go");
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    fireEvent.click(screen.getByRole("button", { name: "Installer" }));
    expect(screen.queryByRole("button", { name: "Commencer" })).toBeNull();
  });

  it("désactive les modes manuels quand aucun niveau ne tient sur la machine", async () => {
    render(<FirstRunSetup bridge={bridgeReturning({ memoryGiB: 2, cores: 2, avx2: false, gpu: null })} t={t} onClose={vi.fn()} />);
    await screen.findByText("2.0 Go");
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    const precise = (await screen.findByRole("radio", { name: /Plus précis/ })) as HTMLInputElement;
    const faster = screen.getByRole("radio", { name: /Plus rapide/ }) as HTMLInputElement;
    expect(precise.disabled).toBe(true);
    expect(faster.disabled).toBe(true);
    expect(screen.getByText("Ce niveau n'est pas disponible sur cette machine.")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Automatique/ }) as HTMLInputElement).disabled).toBe(false);
  });

  it("la page de mode annonce ce qui va être installé, puis l'étape de téléchargement démarre seule", async () => {
    const bridge = {
      hardwareProfile: vi.fn(async () => machine),
      ollamaStatus: vi.fn(async () => ({ reachable: false, models: [] })),
      installOllama: vi.fn(async () => {}),
    } as unknown as NativeBridge & { ollamaStatus: ReturnType<typeof vi.fn> };
    render(<FirstRunSetup bridge={bridge} t={t} onClose={vi.fn()} />);
    await screen.findByText("16.0 Go");
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    expect(screen.getByText(/installer Ollama s'il manque, télécharger qwen2\.5:14b \(9 Go\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Installer" }));
    // Sans Ollama joignable dans ce pont de test, l'installation démarre et le dit : aucun clic n'a été nécessaire.
    expect(await screen.findByText(/Ollama ne répond pas sur ce poste/)).toBeTruthy();
    expect(bridge.ollamaStatus).toHaveBeenCalled();
  });
});
