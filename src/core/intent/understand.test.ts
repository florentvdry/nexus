import { describe, expect, it } from "vitest";

import { beforeAll } from "vitest";

import { loadBuiltinPlugins } from "../plugins/builtin";
import { registerApplications, registerLanguageDictionary } from "./registry";
import { closestAlias, editDistance, splitSteps, stripPoliteness, typoTolerance } from "./understand";
import { parseIntent } from "./parse";

beforeAll(() => {
  loadBuiltinPlugins({ registerCapability: () => {}, registerLanguage: registerLanguageDictionary, registerApplications });
});

describe("politesse et questions", () => {
  it.each([
    ["peux-tu ouvrir Discord ?", "ouvrir Discord"],
    ["Pourriez-vous lancer le Bloc-notes, s'il vous plaît ?", "lancer le Bloc-notes"],
    ["est-ce que tu peux me montrer le CPU", "montrer le CPU"],
    ["je voudrais liste mes fenêtres stp", "liste mes fenêtres"],
    ["can you open discord please", "open discord"],
    ["I'd like to close this window", "close this window"],
  ])("« %s » devient « %s »", (input, expected) => {
    expect(stripPoliteness(input)).toBe(expected);
  });

  it("garde une demande nue telle quelle, chemins et casse compris", () => {
    expect(stripPoliteness('renomme "C:\\Users\\Ana\\Facture.PDF" en x.pdf')).toBe('renomme "C:\\Users\\Ana\\Facture.PDF" en x.pdf');
  });

  it("une formule de politesse ne change pas l'intention reconnue", () => {
    expect(parseIntent("Peux-tu me dire combien de mémoire il reste ?").intent).toEqual({ type: "SYSTEM_INFO" });
    expect(parseIntent("pourrais-tu lancer discord s'il te plaît").intent).toMatchObject({ type: "OPEN_APPLICATION", appId: "discord" });
  });
});

describe("demandes enchaînées", () => {
  it("découpe sur « puis », « ensuite », « then »", () => {
    expect(splitSteps("ouvre discord puis liste mes fenêtres")).toEqual(["ouvre discord", "liste mes fenêtres"]);
    expect(splitSteps("lance le bloc-notes, ensuite montre le cpu")).toEqual(["lance le bloc-notes", "montre le cpu"]);
    expect(splitSteps("open notepad then open calculator")).toEqual(["open notepad", "open calculator"]);
  });

  it("ne découpe pas sur « et » seul, ni au-delà de trois demandes", () => {
    expect(splitSteps("liste le cpu et la ram")).toEqual(["liste le cpu et la ram"]);
    expect(splitSteps("a puis b puis c puis d")).toEqual(["a puis b puis c puis d"]);
  });
});

describe("fautes de frappe", () => {
  it("mesure la distance entre deux mots", () => {
    expect(editDistance("discord", "discrd")).toBe(1);
    expect(editDistance("chat", "chat")).toBe(0);
    expect(editDistance("notepad", "calculator")).toBeGreaterThan(4);
  });

  it("tolère une faute sur un mot long, aucune sur un mot court", () => {
    expect(typoTolerance("calc")).toBe(0);
    expect(typoTolerance("discord")).toBe(1);
    expect(typoTolerance("notepad")).toBe(1);
    expect(typoTolerance("calculator")).toBe(2);
  });

  it("propose l'application proche quand elle est unique, et rien sinon", () => {
    const apps = [
      { id: "discord", alias: "discord" },
      { id: "notepad", alias: "notepad" },
    ];
    expect(closestAlias("discrd", apps)).toEqual({ id: "discord", alias: "discord" });
    expect(closestAlias("spotify", apps)).toBeNull();
    expect(closestAlias("disc", apps)).toBeNull(); // trop court pour une faute
    // Deux applications à égale distance : aucune n'est choisie à la place de l'utilisateur.
    const ambiguous = [
      { id: "a", alias: "discors" },
      { id: "b", alias: "discord" },
    ];
    expect(closestAlias("discor", ambiguous)).toBeNull();
  });

  it("le moteur suggère l'application la plus proche au lieu d'échouer", () => {
    const { intent } = parseIntent("lance Discrd");
    expect(intent).toMatchObject({ type: "OPEN_APPLICATION", appId: undefined, suggestion: { appId: "discord" } });
    expect(parseIntent("lance Spotify").intent).toEqual({ type: "OPEN_APPLICATION", appId: undefined, appName: "spotify" });
  });
});
