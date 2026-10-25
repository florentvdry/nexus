import { describe, expect, it } from "vitest";

import { buildContext, parseShare, type ContextParts } from "./context";

const parts: ContextParts = {
  conversation: "Conversation récente : Utilisateur : bonjour",
  memories: ["Je préfère Firefox", "J'habite à Lyon"],
  shown: "Éléments affichés à l'utilisateur : 1) fichier (C:\\Users\\ana\\cv.pdf)",
  system: ["Date et heure actuelles : 2026-10-25T09:00 (dimanche)."],
};

describe("contexte envoyé au classifieur", () => {
  it("sans catégorie demandée, il ne garde que le système : date, commandes des plugins", () => {
    expect(buildContext(parts, new Set())).toEqual(parts.system);
  });

  it("chaque catégorie cochée ajoute exactement sa part, dans l'ordre", () => {
    const context = buildContext(parts, new Set(["conversation", "memories", "shown"]));
    expect(context).toEqual([parts.conversation, ...parts.memories, parts.shown, ...parts.system]);
  });

  it("les souvenirs seuls ne transportent ni la conversation ni les éléments affichés", () => {
    const context = buildContext(parts, new Set(["memories"]));
    expect(context).toEqual([...parts.memories, ...parts.system]);
  });

  it("une catégorie sans contenu n'ajoute rien", () => {
    expect(buildContext({ ...parts, conversation: null, shown: null }, new Set(["conversation", "shown"]))).toEqual(parts.system);
  });
});

describe("préférence de partage lue depuis le stockage", () => {
  it("ne garde que les catégories connues, sans doublon, et refuse tout le reste", () => {
    expect(parseShare(["memories", "memories", "secret", 3, null, "shown"])).toEqual(["memories", "shown"]);
    expect(parseShare("memories")).toEqual([]);
    expect(parseShare(undefined)).toEqual([]);
  });
});
