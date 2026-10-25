import { describe, expect, it } from "vitest";

import { ASK_TEXT_CHARS, parseWebAnswer, webSources } from "./ask";

const HITS = [
  { title: "GTA RP", url: "https://example.org/a", snippet: "Extrait A" },
  { title: "Forum", url: "https://example.org/b", snippet: "Extrait B" },
  { title: "Blog", url: "https://example.org/c", snippet: "Extrait C" },
  { title: "Ignoré", url: "https://example.org/d", snippet: "Hors des trois premiers" },
];

describe("sources d'une question ouverte", () => {
  it("prend le texte de la page lue, à défaut l'extrait, et numérote les sources", () => {
    const sources = webSources(HITS, [{ url: HITS[0].url, text: "Texte complet A" }, null, { url: HITS[2].url, text: "Texte C" }]);
    expect(sources.map((source) => [source.index, source.text])).toEqual([
      [1, "Texte complet A"],
      [2, "Extrait B"],
      [3, "Texte C"],
    ]);
  });

  it("écarte un résultat sans texte, et ne garde que les trois premiers", () => {
    const hits = [{ title: "Vide", url: "https://example.org/v", snippet: "   " }, ...HITS.slice(1)];
    const sources = webSources(hits, []);
    expect(sources.map((source) => source.url)).toEqual(["https://example.org/b", "https://example.org/c"]);
  });

  it("signale un site commercial au modèle, sans toucher aux autres sources", () => {
    const hits = [
      { title: "Chaise", url: "https://www.amazon.fr/chaise", snippet: "Prix 99 €", kind: "commercial" as const },
      { title: "Fauteuil", url: "https://example.org/f", snippet: "Histoire du fauteuil", kind: "other" as const },
    ];
    const sources = webSources(hits, []);
    expect(sources.map((source) => source.title)).toEqual(["Chaise (site commercial)", "Fauteuil"]);
  });

  it("borne le texte donné au modèle", () => {
    const [source] = webSources([{ title: "Long", url: "https://example.org/l", snippet: "" }], [{ url: "https://example.org/l", text: "x".repeat(ASK_TEXT_CHARS + 500) }]);
    expect(source.text.length).toBe(ASK_TEXT_CHARS);
  });
});

describe("réponse du modèle", () => {
  it("accepte un texte non vide dans « answer »", () => {
    expect(parseWebAnswer({ answer: "  GTA RP est un serveur de jeu.  " })).toBe("GTA RP est un serveur de jeu.");
  });

  it("refuse une réponse vide, absente, ou d'un autre type", () => {
    expect(parseWebAnswer({ answer: "   " })).toBeNull();
    expect(parseWebAnswer({ reply: "autre champ" })).toBeNull();
    expect(parseWebAnswer({ answer: 42 })).toBeNull();
    expect(parseWebAnswer("texte nu")).toBeNull();
    expect(parseWebAnswer(null)).toBeNull();
  });
});
