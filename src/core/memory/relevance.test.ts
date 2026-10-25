import { describe, expect, it } from "vitest";
import { meaningfulTokens, selectRelevantMemories } from "./relevance";

const memories = [
  "Je m'appelle Florent",
  "J'habite à Lyon",
  "Je préfère Firefox pour naviguer",
  "Je suis développeur Rust",
  "Je préfère les réponses courtes",
  "Mon agenda est dans Documents",
  "Je travaille le lundi matin",
  "Mon chat s'appelle Nuage",
];

describe("mots utiles d'une demande", () => {
  it("ignore les mots vides et les accents", () => {
    expect(meaningfulTokens("Ouvre le navigateur préféré de l'utilisateur")).toEqual(["ouvre", "navigateur", "prefere", "utilisateur"]);
  });

  it("ne garde ni les lettres isolées ni les mots vides anglais", () => {
    expect(meaningfulTokens("what is the d l a")).toEqual(["what"]);
  });
});

describe("souvenirs envoyés au modèle", () => {
  it("garde tout quand il n'y en a pas trop", () => {
    expect(selectRelevantMemories(memories, "bonjour", 12)).toEqual(memories);
  });

  it("choisit ceux qui partagent des mots avec la demande", () => {
    const picked = selectRelevantMemories(memories, "quel est mon navigateur préféré ?", 5);
    expect(picked).toContain("Je préfère Firefox pour naviguer");
  });

  it("ne dépasse jamais la limite, même avec beaucoup de souvenirs", () => {
    const many = Array.from({ length: 500 }, (_, index) => `Information numéro ${index} sur la machine`);
    expect(selectRelevantMemories(many, "information machine", 12)).toHaveLength(12);
  });

  it("complète avec les plus récents quand rien ne correspond", () => {
    const many = Array.from({ length: 30 }, (_, index) => `souvenir ${index}`);
    const picked = selectRelevantMemories(many, "quelque chose de sans rapport", 5);
    expect(picked).toEqual(["souvenir 25", "souvenir 26", "souvenir 27", "souvenir 28", "souvenir 29"]);
  });

  it("garde l'ordre chronologique dans le résultat", () => {
    const picked = selectRelevantMemories(memories, "lyon et firefox", 4);
    expect(picked.indexOf("J'habite à Lyon")).toBeLessThan(picked.indexOf("Je préfère Firefox pour naviguer"));
  });

  it("reconnaît un pluriel ou une conjugaison d'un mot de la mémoire", () => {
    const picked = selectRelevantMemories(memories, "mes agendas", 3);
    expect(picked).toContain("Mon agenda est dans Documents");
  });

  it("une limite nulle ne donne aucun souvenir", () => {
    expect(selectRelevantMemories(memories, "Lyon", 0)).toEqual([]);
  });
});
