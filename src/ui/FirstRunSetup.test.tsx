// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("se passe à tout moment, et le passage ferme le parcours sans rien installer", async () => {
    const onClose = vi.fn();
    render(<FirstRunSetup bridge={bridgeReturning(machine)} t={t} onClose={onClose} />);
    await screen.findByText("16.0 Go");
    fireEvent.click(screen.getByRole("button", { name: "Passer" }));
    expect(screen.getByText("Parcours passé. NEXUS utilise les règles seules.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("désactive les modes manuels quand aucun niveau ne tient sur la machine", async () => {
    render(<FirstRunSetup bridge={bridgeReturning({ memoryGiB: 2, cores: 2, avx2: false, gpu: null })} t={t} onClose={vi.fn()} />);
    await screen.findByText("2.0 Go");
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    const precise = (await screen.findByRole("radio", { name: "Plus précis : le niveau le plus élevé que la machine supporte" })) as HTMLInputElement;
    const faster = screen.getByRole("radio", { name: "Plus rapide : niveau léger" }) as HTMLInputElement;
    expect(precise.disabled).toBe(true);
    expect(faster.disabled).toBe(true);
    expect(screen.getByText("Ce niveau n'est pas disponible sur cette machine.")).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Automatique : un test sur votre machine décide" }) as HTMLInputElement).disabled).toBe(false);
  });

  it("explique que le téléchargement n'existe pas encore, sans rien simuler", async () => {
    render(<FirstRunSetup bridge={bridgeReturning(machine)} t={t} onClose={vi.fn()} />);
    await screen.findByText("16.0 Go");
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    expect(screen.getByText(/Le téléchargement du modèle n'est pas encore disponible/)).toBeTruthy();
  });
});
