import { afterEach, describe, expect, it } from "vitest";

import { dictionaryFromPack, registerPacks, type PluginPackData } from "./packs";
import { applicationSearchName, pluginCommandsForModel } from "../intent/registry";



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

  it("un alias ajouté par un paquet donne le nom à chercher sur le PC, et disparaît avec le paquet", () => {
    const aliased: PluginPackData = { ...verbs, language: null, aliases: { applications: [{ id: "Discord", aliases: ["dis cord"] }] } };
    expect(applicationSearchName("Dis Cord")).toBe("Dis Cord");
    registerPacks([aliased]);
    expect(applicationSearchName("Dis Cord")).toBe("Discord");
    registerPacks([]);
    expect(applicationSearchName("Dis Cord")).toBe("Dis Cord");
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
