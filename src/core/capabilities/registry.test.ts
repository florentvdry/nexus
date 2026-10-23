import { describe, expect, it } from "vitest";

import { CapabilityError } from "./errors";
import { CapabilityRegistry } from "./registry";
import type { CapabilityContext, CapabilityManifest, CapabilityResult, Permission } from "./types";
import { translate } from "../../i18n/messages";

const manifest: CapabilityManifest = {
  id: "test.echo",
  name: "Écho",
  version: "1.0.0",
  description: "Capacité de test",
  categories: ["test"],
  inputs: [],
  outputs: [],
  dependencies: [],
  permissions: ["system.read"],
  locality: "local",
  requiredApis: [],
  timeoutMs: 50,
  cost: "local",
  offline: true,
};

function context(signal = new AbortController().signal): CapabilityContext {
  return {
    signal,
    native: {} as CapabilityContext["native"],
    osint: { run: async () => { throw new Error("non utilisé dans ce test"); } },
    locale: "fr",
    t: (key, params) => translate("fr", key, params),
  };
}

function result(caption: string): CapabilityResult {
  return { caption, presentations: [], source: { capabilityId: "test.echo", locality: "local", collectedAt: 0 } };
}

function registryWith(permissions: Permission[] = ["system.read"]) {
  const registry = new CapabilityRegistry(permissions);
  return registry;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CapabilityError) return error.code;
    throw error;
  }
  throw new Error("aucune erreur levée");
}

describe("CapabilityRegistry", () => {
  it("exécute le handler et renvoie son résultat normalisé", async () => {
    const registry = registryWith();
    registry.register(manifest, async (input) => result(`reçu ${input.word}`));
    await expect(registry.invoke("test.echo", { word: "ok" }, context())).resolves.toMatchObject({ caption: "reçu ok" });
  });

  it("refuse les capacités inconnues, désactivées ou sans permission", async () => {
    const registry = registryWith([]);
    registry.register(manifest, async () => result("x"));

    expect(await codeOf(registry.invoke("absent", {}, context()))).toBe("unknown-capability");
    expect(await codeOf(registry.invoke("test.echo", {}, context()))).toBe("permission-denied");

    const granted = registryWith();
    granted.register(manifest, async () => result("x"));
    granted.setEnabled("test.echo", false);
    expect(await codeOf(granted.invoke("test.echo", {}, context()))).toBe("disabled");
  });

  it("isole une erreur de plugin au lieu de la propager", async () => {
    const registry = registryWith();
    registry.register(manifest, async () => {
      throw new TypeError("bug interne");
    });
    expect(await codeOf(registry.invoke("test.echo", {}, context()))).toBe("plugin-failure");
  });

  it("applique le délai d'exécution et annule le travail", async () => {
    const registry = registryWith();
    let seenSignal: AbortSignal | undefined;
    registry.register(manifest, (_input, ctx) => {
      seenSignal = ctx.signal;
      return new Promise(() => {});
    });

    expect(await codeOf(registry.invoke("test.echo", {}, context()))).toBe("timeout");
    expect(seenSignal?.aborted).toBe(true);
  });

  it("propage l'annulation demandée par l'appelant", async () => {
    const registry = registryWith();
    registry.register({ ...manifest, timeoutMs: 5000 }, () => new Promise(() => {}));
    const controller = new AbortController();
    const pending = registry.invoke("test.echo", {}, context(controller.signal));
    controller.abort();
    expect(await codeOf(pending)).toBe("cancelled");
  });

  it("rejette les manifestes invalides", () => {
    const registry = registryWith();
    expect(() => registry.register({ ...manifest, id: "Mauvais Id" }, async () => result("x"))).toThrow();
    expect(() => registry.register({ ...manifest, timeoutMs: 0 }, async () => result("x"))).toThrow();
    expect(() => registry.register({ ...manifest, version: "1.0" }, async () => result("x"))).toThrow();
  });
});
