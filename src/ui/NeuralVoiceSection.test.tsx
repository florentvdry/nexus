// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NativeBridge } from "../core/native/bridge";
import { translate } from "../i18n/messages";
import { NeuralVoiceSection } from "./NeuralVoiceSection";

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate("fr", key, params);

function bridgeWith(installed: Record<string, boolean>, install = vi.fn(async () => {})) {
  return {
    speechNeuralAvailable: vi.fn(async (locale: string) => installed[locale] ?? false),
    speechNeuralInstall: install,
  } as unknown as NativeBridge;
}

afterEach(cleanup);

describe("voix naturelle par langue", () => {
  it("montre si la voix de chaque langue est installée", async () => {
    render(<NeuralVoiceSection bridge={bridgeWith({ fr: true, en: false })} t={t} />);
    expect(await screen.findByText("Installée")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Installer" })).toBeTruthy();
  });

  it("n'installe qu'au clic, pour la langue choisie", async () => {
    const install = vi.fn(async () => {});
    const bridge = bridgeWith({ fr: true, en: false }, install);
    render(<NeuralVoiceSection bridge={bridge} t={t} />);
    expect(install).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Installer" }));
    await waitFor(() => expect(install).toHaveBeenCalledWith("en"));
  });

  it("une installation qui échoue le dit, sans bloquer le réglage", async () => {
    const bridge = bridgeWith({ fr: false, en: false }, vi.fn(async () => {
      throw new Error("réseau coupé");
    }));
    render(<NeuralVoiceSection bridge={bridge} t={t} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Installer" }))[0]);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
