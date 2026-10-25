import { beforeAll, describe, expect, it, vi } from "vitest";

import { registerLanguageDictionary } from "../intent/registry";
import { loadBuiltinPlugins } from "../plugins/builtin";
import { chooseTier, DEFAULT_LIMITS, REFERENCE_CASES, runTierBenchmark, type Classifier, type TierResult } from "./benchmark";
import { candidateTiers, type HardwareProfile } from "./hardware";
import { understandWithModel } from "./branch";
import { buildIntentGrammar, MODEL_INTENT_TYPES } from "./grammar";
import { validateModelIntent } from "./validate";

// Les règles ont besoin du vocabulaire des plugins intégrés, comme au démarrage de NEXUS.
beforeAll(() => {
  loadBuiltinPlugins({ registerCapability: () => {}, registerLanguage: registerLanguageDictionary });
});

const machine = (overrides: Partial<HardwareProfile> = {}): HardwareProfile => ({
  memoryGiB: 8,
  cores: 4,
  avx2: true,
  gpu: null,
  ...overrides,
});

describe("validation de la sortie du modèle", () => {
  it("accepte une intention bien formée et écarte les champs superflus", () => {
    expect(validateModelIntent({ type: "OPEN_APPLICATION", appName: "  Discord  ", extra: 1 })).toEqual({
      type: "OPEN_APPLICATION",
      appName: "Discord",
    });
  });

  it("n'accepte jamais une intention qui doit venir des règles", () => {
    expect(validateModelIntent({ type: "UNKNOWN", text: "x" })).toBeNull();
    expect(validateModelIntent({ type: "UNSUPPORTED", reason: "email", text: "x" })).toBeNull();
  });

  it("refuse un renommage dont le nouveau nom contient un séparateur de dossier", () => {
    expect(validateModelIntent({ type: "FILE_RENAME", path: "C:\\a\\a.txt", newName: "..\\b.txt" })).toBeNull();
    expect(validateModelIntent({ type: "FILE_RENAME", path: "C:\\a\\a.txt", newName: "b.txt" })).toEqual({
      type: "FILE_RENAME",
      path: "C:\\a\\a.txt",
      newName: "b.txt",
    });
  });

  it("refuse un domaine mal formé et une durée hors limites", () => {
    expect(validateModelIntent({ type: "OSINT_DOMAIN", domain: "pas un domaine" })).toBeNull();
    expect(validateModelIntent({ type: "FILE_SEARCH", withinDays: 0 })).toBeNull();
    expect(validateModelIntent({ type: "FILE_SEARCH", withinDays: 7 })).toEqual({ type: "FILE_SEARCH", withinDays: 7 });
  });

  it("accepte une demande de connecteur avec un service optionnel, et refuse une demande sans tâche", () => {
    expect(validateModelIntent({ type: "NEEDS_CONNECTOR", service: "Discord", task: "message à Anthony" })).toEqual({
      type: "NEEDS_CONNECTOR",
      service: "Discord",
      task: "message à Anthony",
    });
    expect(validateModelIntent({ type: "NEEDS_CONNECTOR", service: "Discord" })).toBeNull();
  });

  it("refuse une valeur qui n'est pas du texte", () => {
    expect(validateModelIntent({ type: "OPEN_APPLICATION", appName: 42 })).toBeNull();
    expect(validateModelIntent("OPEN_APPLICATION")).toBeNull();
    expect(validateModelIntent(null)).toBeNull();
  });
});

describe("champs donnés sous un autre nom", () => {
  it("accepte le nouveau nom donné sous « target »", () => {
    expect(validateModelIntent({ type: "FILE_RENAME", path: "nexus-e2e-a.txt", target: "nexus-e2e-renomme.txt" })).toEqual({ type: "FILE_RENAME", path: "nexus-e2e-a.txt", newName: "nexus-e2e-renomme.txt" });
  });
  it("accepte le dossier d'un plugin donné sous « path »", () => {
    expect(validateModelIntent({ type: "PLUGIN_INSTALL", path: "C:\\plugins\\convertisseur" })).toEqual({ type: "PLUGIN_INSTALL", target: "C:\\plugins\\convertisseur" });
  });
  it("accepte le nouveau nom donné sous « query » ou « text »", () => {
    expect(validateModelIntent({ type: "FILE_RENAME", path: "a.txt", query: "b.txt" })).toEqual({ type: "FILE_RENAME", path: "a.txt", newName: "b.txt" });
    expect(validateModelIntent({ type: "FILE_RENAME", path: "photo.jpg", text: "vacances.jpg" })).toEqual({ type: "FILE_RENAME", path: "photo.jpg", newName: "vacances.jpg" });
  });

  it("ne traite une conversion d'unités comme une action sur le presse-papiers que si la demande le nomme", () => {
    expect(validateModelIntent({ type: "CLIPBOARD_ACTION", action: "translate" }, "convertis 12 km en miles")).toBeNull();
    expect(validateModelIntent({ type: "CLIPBOARD_ACTION", action: "translate" }, "traduis le presse-papiers")).toEqual({ type: "CLIPBOARD_ACTION", action: "translate" });
  });

  it("accepte une action de plugin sans commande : le moteur la complète d'après le plugin", () => {
    expect(validateModelIntent({ type: "PLUGIN_ACTION", pluginId: "community.exemple.convertisseur", text: "3 kg en livres" })).toEqual({
      type: "PLUGIN_ACTION",
      pluginId: "community.exemple.convertisseur",
      command: "",
      text: "3 kg en livres",
    });
    expect(validateModelIntent({ type: "PLUGIN_ACTION", pluginId: "community.exemple.convertisseur" })).toBeNull();
  });

  it("prend le nouveau nom dans la demande quand la réponse ne le donne pas", () => {
    expect(validateModelIntent({ type: "FILE_RENAME", path: "nexus-e2e-a.txt" }, "Renomme nexus-e2e-a.txt en nexus-e2e-renomme.txt")).toEqual({ type: "FILE_RENAME", path: "nexus-e2e-a.txt", newName: "nexus-e2e-renomme.txt" });
    expect(validateModelIntent({ type: "FILE_RENAME", path: "a.txt" }, "rename a.txt to final.pdf")).toEqual({ type: "FILE_RENAME", path: "a.txt", newName: "final.pdf" });
  });

  it("ne prend jamais un nom qui sort du dossier depuis la demande", () => {
    expect(validateModelIntent({ type: "FILE_RENAME", path: "a.txt" }, "Renomme a.txt en ../secret.txt")).toBeNull();
  });

  it("refuse un nouveau nom qui sort du dossier, même sous un autre nom de champ", () => {
    expect(validateModelIntent({ type: "FILE_RENAME", path: "a.txt", query: "../secret.txt" })).toBeNull();
  });

  it("accepte le pseudo et le domaine donnés sous « query »", () => {
    expect(validateModelIntent({ type: "OSINT_USERNAME", query: "alice42" })).toEqual({ type: "OSINT_USERNAME", username: "alice42" });
    expect(validateModelIntent({ type: "OSINT_DOMAIN", query: "example.com" })).toEqual({ type: "OSINT_DOMAIN", domain: "example.com" });
  });
});

describe("niveaux selon la machine", () => {
  it("ne propose que le niveau léger à une machine modeste", () => {
    expect(candidateTiers(machine({ memoryGiB: 4, avx2: false }))).toEqual(["light"]);
  });

  it("réserve le niveau précis aux machines avec assez de mémoire, de cœurs et AVX2", () => {
    expect(candidateTiers(machine({ memoryGiB: 16, cores: 8, avx2: true }))).toEqual(["precise", "balanced", "light"]);
    expect(candidateTiers(machine({ memoryGiB: 16, cores: 4, avx2: true }))).toEqual(["balanced", "light"]);
  });

  it("n'impose pas le niveau précis sur une carte de 8 Go : il déborderait dans la mémoire vive", () => {
    const card = { name: "NVIDIA GeForce RTX 4060", vramGiB: 8 };
    expect(candidateTiers(machine({ memoryGiB: 32, cores: 16, gpu: card }))).toEqual(["balanced", "light"]);
  });

  it("garde le niveau précis quand la carte le fait tenir en entier", () => {
    const card = { name: "NVIDIA GeForce RTX 4090", vramGiB: 24 };
    expect(candidateTiers(machine({ memoryGiB: 32, cores: 4, avx2: false, gpu: card }))).toEqual(["precise", "balanced", "light"]);
  });

  it("ne compte pas une carte intégrée (moins de 4 Go) : le processeur décide", () => {
    const integrated = { name: "Intel UHD Graphics", vramGiB: 0 };
    expect(candidateTiers(machine({ memoryGiB: 16, cores: 8, avx2: true, gpu: integrated }))).toEqual(["precise", "balanced", "light"]);
  });
});

describe("choix du niveau", () => {
  const result = (tier: TierResult["tier"], passed: number, averageSeconds: number): TierResult => ({ tier, passed, total: 20, averageSeconds });

  it("garde le plus précis qui passe les deux limites", () => {
    expect(chooseTier([result("precise", 19, 2.5), result("balanced", 18, 1), result("light", 15, 0.4)])).toBe("precise");
  });

  it("descend au niveau suivant quand le précis est trop lent", () => {
    expect(chooseTier([result("precise", 19, 3.4), result("balanced", 18, 1), result("light", 15, 0.4)])).toBe("balanced");
  });

  it("ne garde aucun modèle quand aucun niveau n'est assez rapide : les règles seules", () => {
    expect(chooseTier([result("precise", 20, 5), result("balanced", 20, 5), result("light", 20, 5)])).toBeNull();
    expect(chooseTier([result("light", 19, 9)], DEFAULT_LIMITS)).toBeNull();
  });

  it("la justesse ne refuse plus un modèle : un modèle rapide qui répond mal reste retenu", () => {
    expect(chooseTier([result("light", 0, 1)])).toBe("light");
  });
});

describe("test de référence", () => {
  it("compte les phrases correctes et mesure le temps moyen", async () => {
    const cases = REFERENCE_CASES.slice(0, 4);
    // Une réponse valide pour chaque type : une application doit porter son nom.
    const answers = new Map(
      cases.map((reference) => [reference.text, reference.expected === "OPEN_APPLICATION" ? { type: reference.expected, appName: "Discord" } : { type: reference.expected }]),
    );
    const classifier: Classifier = { classify: vi.fn(async (text: string) => (text === cases[0].text ? { type: "HELP" } : answers.get(text))) };
    let clock = 0;
    const progress = vi.fn();

    const outcome = await runTierBenchmark("light", cases, classifier, { now: () => (clock += 500), onProgress: progress });

    expect(outcome.passed).toBe(3);
    expect(outcome.total).toBe(4);
    expect(outcome.averageSeconds).toBeCloseTo(0.5);
    expect(progress).toHaveBeenCalledTimes(4);
  });

  it("compte comme fausse une réponse qui lève une erreur", async () => {
    const classifier: Classifier = { classify: vi.fn(async () => Promise.reject(new Error("panne"))) };
    const outcome = await runTierBenchmark("light", REFERENCE_CASES.slice(0, 2), classifier, { now: () => 0 });
    expect(outcome.passed).toBe(0);
  });
});

describe("grammaire GBNF", () => {
  it("n'autorise que les intentions connues", () => {
    const grammar = buildIntentGrammar();
    for (const type of MODEL_INTENT_TYPES) expect(grammar).toContain(`\\"${type}\\"`);
    expect(grammar).not.toContain("UNKNOWN");
    expect(grammar).not.toContain("UNSUPPORTED");
  });

  it("refuse une grammaire sans intention", () => {
    expect(() => buildIntentGrammar([])).toThrow();
  });
});

describe("compréhension par le modèle", () => {
  it("toute demande est confiée au modèle, et sa réponse valide devient l'intention", async () => {
    const classify = vi.fn(async () => ({ type: "SYSTEM_INFO" }));
    const understood = await understandWithModel("montre le processeur", { classify });
    expect(classify).toHaveBeenCalledWith("montre le processeur");
    expect(understood).toEqual({ intent: { type: "SYSTEM_INFO" }, source: "model" });
  });

  it("une réponse invalide ne devient jamais une action : c'est une incompréhension", async () => {
    const classify = vi.fn(async () => ({ type: "FILE_TRASH" }));
    const understood = await understandWithModel("xyzzy plugh", { classify });
    expect(understood).toEqual({ intent: { type: "UNKNOWN", text: "xyzzy plugh" }, source: "model" });
  });

  it("après le délai, la requête est annulée et la demande est dite indisponible", async () => {
    let signal: AbortSignal | undefined;
    const classify = vi.fn((_text: string, abort?: AbortSignal) => {
      signal = abort;
      return new Promise<unknown>(() => {});
    });
    const understood = await understandWithModel("xyzzy plugh", { classify } as Classifier, 20);
    expect(understood.source).toBe("unavailable");
    expect(signal?.aborted).toBe(true);
  });

  it("transmet le nom d'application nommé par le modèle, tel quel : aucune liste n'est consultée", async () => {
    const classify = vi.fn(async () => ({ type: "OPEN_APPLICATION", appName: "Discord" }));
    const understood = await understandWithModel("xyzzy plugh", { classify });
    expect(understood.source).toBe("model");
    expect(understood.intent).toEqual({ type: "OPEN_APPLICATION", appName: "Discord" });
  });

  it("une réponse en texte du modèle (UNKNOWN avec reply) est renvoyée telle quelle, pas comme une erreur", async () => {
    const classify = vi.fn(async () => ({ type: "UNKNOWN", reply: "Salut ! Que veux-tu faire ?" }));
    const understood = await understandWithModel("salut", { classify });
    expect(understood).toEqual({ intent: { type: "CHAT", text: "Salut ! Que veux-tu faire ?" }, source: "model" });
  });

  it("un UNKNOWN sans réponse est une incompréhension, renvoyée par le modèle", async () => {
    const classify = vi.fn(async () => ({ type: "UNKNOWN" }));
    const understood = await understandWithModel("xyzzy plugh", { classify });
    expect(understood).toEqual({ intent: { type: "UNKNOWN", text: "xyzzy plugh" }, source: "model" });
  });

  it("sans modèle prêt, rien n'est deviné : la source est « indisponible »", async () => {
    const understood = await understandWithModel("xyzzy plugh", null);
    expect(understood).toEqual({ intent: { type: "UNKNOWN", text: "xyzzy plugh" }, source: "unavailable" });
  });
});
