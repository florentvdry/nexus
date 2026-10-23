import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { loadBuiltinPlugins } from "./builtin";
import { dictionaryFromPack, registerPacks, type PluginPackData } from "./packs";
import { parseIntent } from "../intent/parse";
import { registerApplications, registerLanguageDictionary } from "../intent/registry";

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

  it("ajoute un verbe reconnu sans remplacer le vocabulaire intégré", () => {
    expect(parseIntent("allume discord").intent.type).toBe("UNKNOWN");
    registerPacks([verbs]);
    expect(parseIntent("allume discord").intent).toMatchObject({ type: "OPEN_APPLICATION", appId: "discord" });
    expect(parseIntent("lance discord").intent).toMatchObject({ type: "OPEN_APPLICATION", appId: "discord" });
  });

  it("ajoute un nom alternatif à une application du catalogue", () => {
    registerPacks([{ ...verbs, language: null, aliases: { applications: [{ id: "discord", aliases: ["dis cord"] }] } }]);
    expect(parseIntent("lance dis cord").intent).toMatchObject({ type: "OPEN_APPLICATION", appId: "discord" });
  });

  it("route un déclencheur de commande vers son plugin, avec le texte restant", () => {
    registerPacks([
      {
        ...verbs,
        language: null,
        actions: [
          { name: "convertit", triggers: ["convertis", "convertir"], description: "Convertit" },
          { name: "convertit-tout", triggers: ["convertis tout"], description: "Convertit tout" },
        ],
      },
    ]);
    expect(parseIntent("convertis 12 km en miles").intent).toEqual({
      type: "PLUGIN_ACTION",
      pluginId: "community.ana.verbes",
      command: "convertit",
      text: "12 km en miles",
    });
    expect(parseIntent("convertis tout 3").intent).toMatchObject({ type: "PLUGIN_ACTION", command: "convertit-tout", text: "3" });
  });

  it("ne confond pas un déclencheur avec un mot qui le contient", () => {
    registerPacks([{ ...verbs, language: null, actions: [{ name: "convertit", triggers: ["convertis"], description: "x" }] }]);
    expect(parseIntent("convertisseur 12 km").intent.type).toBe("UNKNOWN");
  });

  it("retire les paquets désinstallés : leur vocabulaire disparaît aussitôt", () => {
    registerPacks([verbs]);
    registerPacks([]);
    expect(parseIntent("allume discord").intent.type).toBe("UNKNOWN");
  });
});
