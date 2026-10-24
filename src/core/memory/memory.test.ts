import { describe, expect, it, vi } from "vitest";

import { translate } from "../../i18n/messages";
import { MemoryController, type MemoryBridge } from "./memory";
import type { Memory } from "./types";

const memory = (id: number, text: string): Memory => ({ id, text, createdAt: 0, source: "user" });

/** Pont simulé : un registre en mémoire, comme le natif, sans disque. */
function fakeBridge(initial: Memory[] = []) {
  let items = [...initial];
  const bridge: MemoryBridge = {
    memoryList: vi.fn(async () => [...items]),
    memoryAdd: vi.fn(async (text: string, source: "user" | "model") => {
      const created: Memory = { id: items.length + 1, text, createdAt: 0, source };
      items.push(created);
      return created;
    }),
    memoryForget: vi.fn(async (query: string) => {
      const before = items.length;
      items = items.filter((item) => !item.text.toLowerCase().includes(query.toLowerCase()));
      return before - items.length;
    }),
    memoryClear: vi.fn(async () => {
      const count = items.length;
      items = [];
      return count;
    }),
  };
  return bridge;
}

function setup(bridge: MemoryBridge) {
  const said: string[] = [];
  const controller = new MemoryController({
    bridge,
    say: (text) => said.push(text),
    t: (key, params) => translate("fr", key, params),
  });
  return { controller, said };
}

describe("souvenirs : enregistrés sans question", () => {
  it("une information du modèle est gardée tout de suite, sans nombre limite", async () => {
    const bridge = fakeBridge();
    const { controller, said } = setup(bridge);
    for (let index = 0; index < 250; index += 1) await controller.remember(`fait ${index}`);
    expect(bridge.memoryAdd).toHaveBeenCalledTimes(250);
    expect(bridge.memoryAdd).toHaveBeenLastCalledWith("fait 249", "model");
    expect(said.at(-1)).toContain("fait 249");
  });

  it("les textes sont donnés au modèle, et rien si la lecture échoue", async () => {
    const { controller } = setup(fakeBridge([memory(1, "Prénom : Florent")]));
    expect(await controller.texts()).toEqual(["Prénom : Florent"]);
    const broken = setup({ ...fakeBridge(), memoryList: vi.fn(async () => Promise.reject(new Error("panne"))) } as MemoryBridge);
    expect(await broken.controller.texts()).toEqual([]);
  });
});

describe("oubli et liste", () => {
  it("oublie les souvenirs qui correspondent, et dit s'il n'y en a aucun", async () => {
    const bridge = fakeBridge([memory(1, "Je préfère Firefox"), memory(2, "Prénom : Florent")]);
    const { controller, said } = setup(bridge);
    await controller.forget("firefox");
    expect(said.at(-1)).toContain("1 souvenir");
    await controller.forget("chrome");
    expect(said.at(-1)).toContain("Je ne retiens rien qui corresponde");
  });

  it("« tout oublier » demande confirmation avant d'effacer", async () => {
    const bridge = fakeBridge([memory(1, "Je préfère Firefox")]);
    const { controller, said } = setup(bridge);
    await controller.forget(null);
    expect(bridge.memoryClear).not.toHaveBeenCalled();
    expect(said.at(-1)).toContain("Effacer");
    expect(controller.awaitsAnswer).toBe(true);
    expect(await controller.consume("oui")).toBe(true);
    expect(bridge.memoryClear).toHaveBeenCalledTimes(1);
  });

  it("« non » à la confirmation n'efface rien", async () => {
    const bridge = fakeBridge([memory(1, "Je préfère Firefox")]);
    const { controller, said } = setup(bridge);
    await controller.forget(null);
    await controller.consume("non");
    expect(bridge.memoryClear).not.toHaveBeenCalled();
    expect(said.at(-1)).toContain("je ne retiens rien");
  });

  it("une saisie sans rapport abandonne la confirmation", async () => {
    const bridge = fakeBridge([memory(1, "Je préfère Firefox")]);
    const { controller } = setup(bridge);
    await controller.forget(null);
    expect(await controller.consume("quelle heure est-il ?")).toBe(false);
    expect(controller.awaitsAnswer).toBe(false);
    expect(bridge.memoryClear).not.toHaveBeenCalled();
  });

  it("liste les souvenirs numérotés, ou dit qu'il n'y en a pas", async () => {
    const empty = setup(fakeBridge());
    await empty.controller.list();
    expect(empty.said[0]).toContain("Je ne retiens rien");

    const { controller, said } = setup(fakeBridge([memory(1, "Je préfère Firefox"), memory(2, "Prénom : Florent")]));
    await controller.list();
    expect(said[0]).toContain("1) Je préfère Firefox");
    expect(said[0]).toContain("2) Prénom : Florent");
  });
});
