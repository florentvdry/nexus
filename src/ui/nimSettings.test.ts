// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NativeBridge } from "../core/native/bridge";
import { migrateLegacyNimKey, readNimSettings, readOnlineModel, writeNimSettings } from "./nimSettings";

function bridgeWith(nimKeySave: (key: string) => Promise<void>): NativeBridge {
  return { nimKeySave } as unknown as NativeBridge;
}

describe("NVIDIA NIM : préférences et clé", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("la clé gardée dans le navigateur par une ancienne version part au natif, puis est retirée", async () => {
    window.localStorage.setItem("nexus.nim.key", "  nvapi-ancienne  ");
    const nimKeySave = vi.fn(async () => {});
    await migrateLegacyNimKey(bridgeWith(nimKeySave));
    expect(nimKeySave).toHaveBeenCalledWith("nvapi-ancienne");
    expect(window.localStorage.getItem("nexus.nim.key")).toBeNull();
  });

  it("si le stockage natif refuse la clé, elle reste en place pour une nouvelle tentative", async () => {
    window.localStorage.setItem("nexus.nim.key", "nvapi-ancienne");
    await migrateLegacyNimKey(
      bridgeWith(async () => {
        throw new Error("chiffrement indisponible");
      }),
    );
    expect(window.localStorage.getItem("nexus.nim.key")).toBe("nvapi-ancienne");
  });

  it("les préférences ne gardent jamais de clé, et seul l'activation ouvre le modèle en ligne", () => {
    expect(readOnlineModel()).toBeNull();
    writeNimSettings({ enabled: true, model: "meta/llama-3.1-8b-instruct" });
    expect(readNimSettings()).toEqual({ enabled: true, model: "meta/llama-3.1-8b-instruct" });
    const online = readOnlineModel();
    expect(online).toEqual({ model: "meta/llama-3.1-8b-instruct" });
    expect(Object.keys(online ?? {})).not.toContain("key");
    const stored = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.getItem(window.localStorage.key(index) ?? "") ?? "");
    expect(stored.join(" ")).not.toContain("nvapi");
  });
});
