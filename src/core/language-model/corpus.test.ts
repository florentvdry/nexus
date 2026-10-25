import { describe, expect, it } from "vitest";
import corpus from "./corpus.json";
import { MODEL_INTENT_TYPES } from "./grammar";

/** Corpus partagé avec le banc de compréhension du natif (`src-tauri/src/comprehension_bench.rs`). */
interface CorpusCase {
  lang: "fr" | "en";
  category: string;
  text: string;
  expected: string[];
}

const cases = corpus as CorpusCase[];
const CATEGORIES = ["simple", "politesse", "faute", "anglais", "compose", "memoire", "bavardage", "ambigu"];

describe("corpus de compréhension", () => {
  it("compte au moins cent demandes, françaises et anglaises", () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
    expect(new Set(cases.map((item) => item.lang))).toEqual(new Set(["fr", "en"]));
  });

  it("n'attend que des intentions connues du modèle, ou UNKNOWN", () => {
    const known = new Set<string>([...MODEL_INTENT_TYPES, "UNKNOWN"]);
    for (const item of cases) {
      expect(item.expected.length).toBeGreaterThan(0);
      for (const type of item.expected) expect(known.has(type), `${item.text} -> ${type}`).toBe(true);
    }
  });

  it("utilise des catégories connues et couvre chacune d'elles", () => {
    const used = new Set(cases.map((item) => item.category));
    for (const category of used) expect(CATEGORIES).toContain(category);
    for (const category of CATEGORIES) expect(used.has(category), category).toBe(true);
  });

  it("ne répète aucune demande", () => {
    const texts = cases.map((item) => item.text.toLowerCase());
    expect(new Set(texts).size).toBe(texts.length);
  });
});
