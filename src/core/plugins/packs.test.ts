import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { loadBuiltinPlugins } from "./builtin";
import { dictionaryFromPack, registerPacks, type PluginPackData } from "./packs";
import { findApplication } from "../intent/dictionaries";
import { normalize } from "../intent/normalize";
import { pluginCommandsForModel, registeredApplications, registerApplications, registerLanguageDictionary } from "../intent/registry";

beforeAll(() => {
  loadBuiltinPlugins({ registerCapability: () => {}, registerLanguage: registerLanguageDictionary, registerApplications });
});

afterEach(() => registerPacks([]));

const verbs: PluginPackData = {
  id: "community.ana.verbes",
  name: "Verbes",
  version: "1.0.0",
  language: { locale: "fr", phrases: { openVerbs: ["allume", "mets en route"] }, fillers: ["le"] },
  aliases: null,
  actions: [],
};

describe("paquets de données", () => {
  it("transforme les expressions en mots entiers, sans interpréter de syntaxe", () => {
    const dictionary = dictionaryFromPack(verbs.language!);
    expect(dictionary.openVerbs[0].test("allume discord")).toBe(true);
    expect(dictionary.openVerbs[0].test("allumeur discord")).toBe(false);
    expect("le bloc notes".replace(dictionary.fillerWords, "")).toBe("bloc notes");
  });

  it("un alias ajouté par un paquet retrouve l'application pour le modèle, et disparaît avec le paquet", () => {
    const aliased: PluginPackData = { ...verbs, language: null, aliases: { applications: [{ id: "discord", aliases: ["dis cord"] }] } };
    expect(findApplication(normalize("dis cord"), registeredApplications())).toBeUndefined();
    registerPacks([aliased]);
    expect(findApplication(normalize("dis cord"), registeredApplications())?.entry.id).toBe("discord");
    registerPacks([]);
    expect(findApplication(normalize("dis cord"), registeredApplications())).toBeUndefined();
  });

  it("les commandes des plugins installés sont données au modèle avec leur identifiant", () => {
    expect(pluginCommandsForModel()).toEqual([]);
    registerPacks([
      {
        ...verbs,
        language: null,
        actions: [{ name: "convertit", triggers: ["convertis", "convertir"], description: "Convertit" }],
      },
    ]);
    expect(pluginCommandsForModel()).toEqual(["community.ana.verbes / convertit (ex. : convertis, convertir)"]);
  });
});
