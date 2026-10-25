import { describe, expect, it } from "vitest";

import { parseDelimited } from "./csv";

describe("parseDelimited", () => {
  it("lit une virgule et garde les champs entre guillemets", () => {
    const { rows } = parseDelimited('nom,ville\n"Dupont, Ana","Lyon"\n');
    expect(rows).toEqual([
      ["nom", "ville"],
      ["Dupont, Ana", "Lyon"],
    ]);
  });

  it("gère les guillemets doublés et les retours à la ligne dans un champ", () => {
    const { rows } = parseDelimited('texte\n"il dit ""oui""","ligne 1\nligne 2"\n');
    expect(rows[1]).toEqual(['il dit "oui"', "ligne 1\nligne 2"]);
  });

  it("détecte le point-virgule, usuel dans les exports français", () => {
    const { rows } = parseDelimited("montant;devise\n12,50;EUR\n");
    expect(rows).toEqual([
      ["montant", "devise"],
      ["12,50", "EUR"],
    ]);
  });

  it("détecte la tabulation d'un fichier TSV", () => {
    const { rows } = parseDelimited("a\tb\n1\t2\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("accepte CRLF, ignore le BOM et une ligne finale vide", () => {
    const { rows, total } = parseDelimited("﻿a,b\r\n1,2\r\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(total).toBe(2);
  });

  it("complète les lignes courtes pour garder un tableau rectangulaire", () => {
    const { rows } = parseDelimited("a,b,c\n1\n");
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "", ""],
    ]);
  });

  it("garde la dernière ligne même sans retour à la ligne final", () => {
    expect(parseDelimited("a,b\n1,2").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("renvoie un tableau vide pour un fichier vide", () => {
    expect(parseDelimited("")).toEqual({ rows: [], total: 0 });
  });
});
