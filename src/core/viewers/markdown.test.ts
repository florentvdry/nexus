import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdown } from "./markdown";

describe("parseMarkdown : blocs", () => {
  it("lit les titres avec leur niveau", () => {
    expect(parseMarkdown("# Titre\n\n### Sous-partie")).toEqual([
      { kind: "heading", level: 1, text: "Titre" },
      { kind: "heading", level: 3, text: "Sous-partie" },
    ]);
  });

  it("regroupe les lignes d'un paragraphe et sépare les paragraphes par une ligne vide", () => {
    expect(parseMarkdown("une phrase\nla suite\n\nautre paragraphe")).toEqual([
      { kind: "paragraph", text: "une phrase\nla suite" },
      { kind: "paragraph", text: "autre paragraphe" },
    ]);
  });

  it("lit les listes à puces et les listes numérotées", () => {
    expect(parseMarkdown("- un\n- deux\n\n1. premier\n2) second")).toEqual([
      { kind: "list", ordered: false, items: ["un", "deux"] },
      { kind: "list", ordered: true, items: ["premier", "second"] },
    ]);
  });

  it("garde le contenu d'un bloc de code tel quel, sans l'interpréter", () => {
    const blocks = parseMarkdown("```ts\nconst a = '# pas un titre';\n- pas une liste\n```\nfin");
    expect(blocks).toEqual([
      { kind: "code", language: "ts", text: "const a = '# pas un titre';\n- pas une liste" },
      { kind: "paragraph", text: "fin" },
    ]);
  });

  it("va jusqu'à la fin si un bloc de code n'est pas fermé", () => {
    expect(parseMarkdown("~~~\nreste du fichier")).toEqual([{ kind: "code", language: "", text: "reste du fichier" }]);
  });

  it("lit les citations et les règles horizontales", () => {
    expect(parseMarkdown("> citation\n> sur deux lignes\n\n---")).toEqual([
      { kind: "quote", text: "citation\nsur deux lignes" },
      { kind: "rule" },
    ]);
  });

  it("accepte des fins de ligne Windows", () => {
    expect(parseMarkdown("# A\r\n\r\ntexte\r\n")).toEqual([
      { kind: "heading", level: 1, text: "A" },
      { kind: "paragraph", text: "texte" },
    ]);
  });

  it("ne lit pas un dièse sans espace comme un titre", () => {
    expect(parseMarkdown("#hashtag")).toEqual([{ kind: "paragraph", text: "#hashtag" }]);
  });
});

describe("parseInline", () => {
  it("sépare le texte, le code, le gras et l'italique", () => {
    expect(parseInline("un **gras**, de l'`code` et *italique*")).toEqual([
      { kind: "text", text: "un " },
      { kind: "strong", text: "gras" },
      { kind: "text", text: ", de l'" },
      { kind: "code", text: "code" },
      { kind: "text", text: " et " },
      { kind: "em", text: "italique" },
    ]);
  });

  it("garde les liens comme texte cliquable sans navigation, avec leur adresse", () => {
    expect(parseInline("voir [la doc](https://example.com/doc)")).toEqual([
      { kind: "text", text: "voir " },
      { kind: "link", text: "la doc", href: "https://example.com/doc" },
    ]);
  });

  it("affiche le texte alternatif d'une image au lieu de la charger", () => {
    expect(parseInline("![logo NEXUS](https://example.com/logo.png)")).toEqual([{ kind: "text", text: "logo NEXUS" }]);
  });

  it("ne coupe pas un nom avec des soulignés", () => {
    expect(parseInline("le fichier nom_de_fichier.txt")).toEqual([{ kind: "text", text: "le fichier nom_de_fichier.txt" }]);
  });

  it("rend un texte sans balisage tel quel", () => {
    expect(parseInline("rien ici")).toEqual([{ kind: "text", text: "rien ici" }]);
  });
});
