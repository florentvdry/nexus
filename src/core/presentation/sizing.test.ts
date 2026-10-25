import { describe, expect, it } from "vitest";

import { MAX_WINDOW_HEIGHT, VIEWER_HEIGHT, VIEWER_WIDTH, estimateSize } from "./sizing";

describe("estimateSize", () => {
  it("grandit avec les valeurs longues, sans dépasser la hauteur maximale", () => {
    const short = estimateSize({ kind: "information-card", title: "t", rows: [{ label: "a", value: "b" }] });
    const long = estimateSize({ kind: "information-card", title: "t", rows: [{ label: "a", value: "x".repeat(200) }] });
    expect(long.height).toBeGreaterThan(short.height);
    const many = estimateSize({ kind: "information-card", title: "t", rows: Array.from({ length: 40 }, () => ({ label: "a", value: "b" })) });
    expect(many.height).toBe(MAX_WINDOW_HEIGHT);
  });

  /** La visionneuse garde une taille stable : son contenu (page, tableau, texte) défile à l'intérieur. */
  it("donne à la visionneuse une taille fixe, qui tient dans la colonne libre d'un écran 1280 × 800", () => {
    const viewer = estimateSize({ kind: "file-view", title: "rapport.pdf", path: "C:\\Docs\\rapport.pdf" });
    expect(viewer).toEqual({ width: VIEWER_WIDTH, height: VIEWER_HEIGHT });
    // Réduite à 70 % (plus petite taille admise), elle reste dans les 290 px libres à droite de l'orbe.
    expect(Math.round(viewer.width * 0.7)).toBeLessThanOrEqual(290);
  });
});
