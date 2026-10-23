// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HardwareProfile } from "../core/language-model/hardware";
import type { NativeBridge } from "../core/native/bridge";
import { translate } from "../i18n/messages";
import { HardwareSection } from "./HardwareSection";

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate("fr", key, params);

function bridgeReturning(profile: HardwareProfile | Error) {
  return {
    hardwareProfile: vi.fn(async () => {
      if (profile instanceof Error) throw profile;
      return profile;
    }),
  } as unknown as NativeBridge;
}

describe("matériel dans les réglages", () => {
  afterEach(cleanup);

  it("affiche la carte graphique avec sa mémoire dédiée", async () => {
    const profile: HardwareProfile = {
      memoryGiB: 31.8,
      cores: 8,
      avx2: true,
      gpu: { name: "NVIDIA GeForce RTX 4060", vramGiB: 8 },
    };
    render(<HardwareSection bridge={bridgeReturning(profile)} t={t} />);
    expect(await screen.findByText("NVIDIA GeForce RTX 4060 · 8.0 Go")).toBeTruthy();
    expect(screen.getByText("31.8 Go")).toBeTruthy();
  });

  it("dit clairement quand aucune carte n'est détectée", async () => {
    render(<HardwareSection bridge={bridgeReturning({ memoryGiB: 16, cores: 4, avx2: false, gpu: null })} t={t} />);
    expect(await screen.findByText("non détectée")).toBeTruthy();
  });

  it("indique l'indisponibilité au lieu d'afficher de fausses valeurs", async () => {
    render(<HardwareSection bridge={bridgeReturning(new Error("indisponible"))} t={t} />);
    expect(await screen.findByText("Cette information n'est pas disponible sur cette installation.")).toBeTruthy();
  });
});
