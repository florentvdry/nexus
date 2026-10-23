import { describe, expect, it } from "vitest";

import { detectTextLanguage } from "./language";

describe("detectTextLanguage", () => {
  it.each([
    ["Lance Discord", "fr"],
    ["Affiche l'utilisation du processeur", "fr"],
    ["Ferme cette fenêtre", "fr"],
    ["Open Notepad", "en"],
    ["Show the CPU usage", "en"],
  ])("« %s » est reconnu en %s", (text, language) => {
    expect(detectTextLanguage(text)).toBe(language);
  });

  it("ne tranche pas quand le texte ne contient aucun indice", () => {
    expect(detectTextLanguage("Discord")).toBeUndefined();
  });
});
