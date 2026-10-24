import { describe, expect, it, vi } from "vitest";

import { REFERENCE_CASES } from "./benchmark";
import { installBestModel, type InstallStage } from "./install";
import type { PullProgress } from "./ollama";
import { tierSpec, type ModelTier } from "./tiers";

/** Bonne réponse pour chaque phrase de référence, avec les champs que la validation exige. */
function answerFor(expected: string): Record<string, string> {
  switch (expected) {
    case "OPEN_APPLICATION":
      return { type: expected, appName: "Discord" };
    case "FILE_RENAME":
      return { type: expected, path: "C:\\Docs\\a.txt", newName: "b.txt" };
    case "FILE_MOVE":
      return { type: expected, path: "C:\\Docs\\notes.txt", toDir: "C:\\Docs\\Archives" };
    case "FILE_TRASH":
      return { type: expected, path: "C:\\Docs\\vieux.txt" };
    case "OSINT_DOMAIN":
      return { type: expected, domain: "example.com" };
    case "WINDOW_CLOSE":
      return { type: expected, name: "Discord" };
    default:
      return { type: expected };
  }
}

/** Faux pont : chaque modèle répond juste, à une vitesse fixée (secondes par phrase), et les téléchargements sont notés. */
function fakeBridge(secondsPerCase: Record<string, number>) {
  let clock = 0;
  const pulled: string[] = [];
  const answers = new Map(REFERENCE_CASES.map((reference) => [reference.text, answerFor(reference.expected)]));
  return {
    bridge: {
      classifyIntent: vi.fn(async (text: string, model: string) => {
        // L'horloge du benchmark est en millisecondes.
        clock += (secondsPerCase[model] ?? 0) * 1000;
        return answers.get(text);
      }),
      pullModel: vi.fn(async (model: string, onProgress: (progress: PullProgress) => void) => {
        pulled.push(model);
        onProgress({ model, status: "success", completed: null, total: null });
      }),
    },
    pulled,
    now: () => clock,
  };
}

const modelOf = (tier: ModelTier) => tierSpec(tier).model;

describe("installation du modèle après accord", () => {
  it("un modèle déjà installé est seulement testé : ni téléchargement ni demande d'accord", async () => {
    const { bridge, pulled, now } = fakeBridge({ [modelOf("precise")]: 1 });
    const confirm = vi.fn(async () => true);
    const outcome = await installBestModel({ bridge, tiers: ["precise"], installed: [modelOf("precise")], confirm, onStage: () => {}, now });
    expect(outcome?.model).toBe(modelOf("precise"));
    expect(outcome?.tier).toBe("precise");
    expect(confirm).not.toHaveBeenCalled();
    expect(pulled).toEqual([]);
  });

  it("télécharge après accord, avec la taille affichée, puis teste", async () => {
    const { bridge, pulled, now } = fakeBridge({ [modelOf("precise")]: 1 });
    const confirm = vi.fn(async () => true);
    const stages: InstallStage[] = [];
    const outcome = await installBestModel({ bridge, tiers: ["precise"], installed: [], confirm, onStage: (stage) => stages.push(stage), now });
    expect(confirm).toHaveBeenCalledWith(modelOf("precise"), tierSpec("precise").fileGiB);
    expect(pulled).toEqual([modelOf("precise")]);
    expect(outcome?.model).toBe(modelOf("precise"));
    expect(stages.some((stage) => stage.kind === "pulling")).toBe(true);
    expect(stages.some((stage) => stage.kind === "testing" && stage.index === REFERENCE_CASES.length)).toBe(true);
  });

  it("refuser le téléchargement arrête tout : rien n'est téléchargé ni utilisé", async () => {
    const { bridge, pulled, now } = fakeBridge({});
    const outcome = await installBestModel({ bridge, tiers: ["precise", "light"], installed: [], confirm: async () => false, onStage: () => {}, now });
    expect(outcome).toBeNull();
    expect(pulled).toEqual([]);
  });

  it("un niveau trop lent propose le suivant, après un nouvel accord", async () => {
    const { bridge, pulled, now } = fakeBridge({ [modelOf("precise")]: 5, [modelOf("balanced")]: 0.5 });
    const confirm = vi.fn(async () => true);
    const stages: InstallStage[] = [];
    const outcome = await installBestModel({
      bridge,
      tiers: ["precise", "balanced"],
      installed: [],
      confirm,
      onStage: (stage) => stages.push(stage),
      now,
    });
    expect(stages.some((stage) => stage.kind === "too-slow" && stage.model === modelOf("precise"))).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(pulled).toEqual([modelOf("precise"), modelOf("balanced")]);
    expect(outcome?.tier).toBe("balanced");
  });

  it("si aucun niveau ne passe, le résultat est vide : NEXUS reste sur les règles seules", async () => {
    const { bridge, now } = fakeBridge({ [modelOf("precise")]: 5, [modelOf("balanced")]: 5, [modelOf("light")]: 5 });
    const outcome = await installBestModel({ bridge, tiers: ["precise", "balanced", "light"], installed: [modelOf("precise"), modelOf("balanced"), modelOf("light")], confirm: async () => true, onStage: () => {}, now });
    expect(outcome).toBeNull();
  });
});
