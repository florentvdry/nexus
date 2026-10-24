// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { NativeBridge } from "../core/native/bridge";
import { translate } from "../i18n/messages";
import { ModelInstaller, installPercent } from "./ModelInstaller";

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate("fr", key, params);

/** Pont simulé : Ollama joignable ou non, installation qui réussit ou non, aucun modèle installé, test qui ne répond jamais. */
function bridgeWith({ reachable, installAfterwards = true }: { reachable: boolean; installAfterwards?: boolean }) {
  let running = reachable;
  return {
    ollamaStatus: vi.fn(async () => ({ reachable: running, models: [] })),
    installOllama: vi.fn(async (onStage: (stage: string) => void) => {
      onStage("installing");
      if (installAfterwards) running = true;
      onStage("ready");
    }),
    classifyIntent: vi.fn(() => new Promise<unknown>(() => {})),
    pullModel: vi.fn(async () => {}),
  };
}

describe("installation automatique dans le parcours", () => {
  beforeAll(() => {
    // jsdom ne fournit pas de contexte 2D : l'orbe reste inactive dans les tests.
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  });
  afterEach(cleanup);

  it("sans Ollama, l'installe seul puis télécharge le modèle, sans aucun clic", async () => {
    const bridge = bridgeWith({ reachable: false });
    render(<ModelInstaller bridge={bridge as unknown as NativeBridge} t={t} tiers={["precise"]} onFinish={vi.fn()} autoStart />);
    await waitFor(() => expect(bridge.installOllama).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(bridge.pullModel).toHaveBeenCalledWith("qwen2.5:14b", expect.any(Function)));
    expect(screen.queryByRole("button", { name: "Installer Ollama" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Télécharger" })).toBeNull();
  });

  it("avec Ollama déjà lancé, télécharge le modèle tout de suite", async () => {
    const bridge = bridgeWith({ reachable: true });
    render(<ModelInstaller bridge={bridge as unknown as NativeBridge} t={t} tiers={["precise"]} onFinish={vi.fn()} autoStart />);
    await waitFor(() => expect(bridge.pullModel).toHaveBeenCalledWith("qwen2.5:14b", expect.any(Function)));
    expect(bridge.installOllama).not.toHaveBeenCalled();
  });

  it("StrictMode n'installe qu'une seule fois", async () => {
    const bridge = bridgeWith({ reachable: true });
    render(
      <StrictMode>
        <ModelInstaller bridge={bridge as unknown as NativeBridge} t={t} tiers={["precise"]} onFinish={vi.fn()} autoStart />
      </StrictMode>,
    );
    await waitFor(() => expect(bridge.pullModel).toHaveBeenCalled());
    expect(bridge.ollamaStatus).toHaveBeenCalledTimes(1);
    expect(bridge.pullModel).toHaveBeenCalledTimes(1);
  });

  it("un échec d'installation reste affiché avec sa cause, sans être compté comme « aucun modèle »", async () => {
    const bridge = bridgeWith({ reachable: false });
    bridge.installOllama.mockRejectedValueOnce(new Error("winget introuvable"));
    const onFinish = vi.fn();
    render(<ModelInstaller bridge={bridge as unknown as NativeBridge} t={t} tiers={["precise"]} onFinish={onFinish} autoStart />);
    expect(await screen.findByText("L'installation s'est arrêtée : winget introuvable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("si Ollama ne peut pas être démarré après l'installation, le dit et propose de réessayer", async () => {
    const bridge = bridgeWith({ reachable: false, installAfterwards: false });
    render(<ModelInstaller bridge={bridge as unknown as NativeBridge} t={t} tiers={["precise"]} onFinish={vi.fn()} autoStart />);
    expect(await screen.findByText(/Ollama ne répond pas sur ce poste/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
    expect(bridge.pullModel).not.toHaveBeenCalled();
  });
});

describe("avancement affiché", () => {
  it("le téléchargement compte pour 70 % et le test pour les 30 % restants", () => {
    expect(installPercent({ kind: "pulling", model: "m", status: "downloading", completed: 50, total: 100 }, false)).toBe(35);
    expect(installPercent({ kind: "testing", model: "m", index: 11, total: 22 }, false)).toBe(85);
    expect(installPercent({ kind: "testing", model: "m", index: 22, total: 22 }, false)).toBe(100);
  });

  it("n'invente pas de pourcentage quand la durée est inconnue", () => {
    expect(installPercent(null, false)).toBeNull();
    expect(installPercent({ kind: "pulling", model: "m", status: "pulling manifest", completed: null, total: null }, false)).toBe(0);
  });

  it("affiche 100 % une fois prêt", () => {
    expect(installPercent(null, true)).toBe(100);
  });
});

describe("installation manuelle (hors parcours)", () => {
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  });
  afterEach(cleanup);

  it("sans démarrage automatique, demande l'accord avec la taille, et un refus n'installe rien", async () => {
    const bridge = bridgeWith({ reachable: true });
    const onFinish = vi.fn();
    render(<ModelInstaller bridge={bridge as unknown as NativeBridge} t={t} tiers={["precise"]} onFinish={onFinish} />);
    fireEvent.click(screen.getByRole("button", { name: "Vérifier Ollama et tester le modèle" }));
    expect(await screen.findByText("Télécharger qwen2.5:14b (9 Go) ?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Arrêter" }));
    expect(await screen.findByText("Aucun modèle n'a passé le test : NEXUS reste sur les règles seules.")).toBeTruthy();
    expect(bridge.pullModel).not.toHaveBeenCalled();
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith(null));
  });
});
