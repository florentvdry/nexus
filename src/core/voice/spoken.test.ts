import { describe, expect, it } from "vitest";

import { pickVoice, voiceScore } from "../../../plugins/speech/system-tts";
import { spokenSentences } from "./spoken";

describe("texte lu à voix haute", () => {
  it("retire les adresses, la ligne de sources et les symboles d'écran", () => {
    const reply = "GTA RP est un serveur de roleplay.\nSources : https://fivem.net/ · https://gtarpserver.com/best";
    expect(spokenSentences(reply)).toEqual(["GTA RP est un serveur de roleplay."]);
  });

  it("garde les phrases séparées, et les lit une par une", () => {
    expect(spokenSentences("Première phrase. Deuxième ! Troisième ?")).toEqual(["Première phrase.", "Deuxième!", "Troisième?"]);
  });

  it("enlève puces, astérisques et guillemets français", () => {
    expect(spokenSentences("- **Marie Curie** est « physicienne ».")).toEqual(["Marie Curie est physicienne."]);
  });

  it("coupe une phrase trop longue aux virgules", () => {
    const long = Array.from({ length: 30 }, (_, index) => `morceau ${index}`).join(", ") + ".";
    const parts = spokenSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 200)).toBe(true);
  });

  it("ne laisse pas d'espace à l'intérieur des parenthèses", () => {
    expect(spokenSentences("Je peux lancer une application (« Lance Discord »).")).toEqual(["Je peux lancer une application (Lance Discord)."]);
  });

  it("ne lit pas de segment sans lettre ni chiffre", () => {
    expect(spokenSentences("  ... ;  ")).toEqual([]);
  });
});

describe("choix de la voix", () => {
  const voices = [
    { name: "Microsoft Zira Desktop", lang: "en-US" },
    { name: "Microsoft Hortense Desktop", lang: "fr-FR" },
    { name: "Microsoft Denise Online (Natural)", lang: "fr-FR" },
    { name: "Microsoft Julie Desktop", lang: "fr-CA" },
  ] as SpeechSynthesisVoice[];

  it("préfère une voix naturelle de la bonne langue", () => {
    expect(pickVoice(voices, "fr-FR", null)?.name).toBe("Microsoft Denise Online (Natural)");
  });

  it("garde une voix demandée par son nom, même si elle n'est pas naturelle", () => {
    expect(pickVoice(voices, "fr-FR", "Microsoft Hortense Desktop")?.name).toBe("Microsoft Hortense Desktop");
  });

  it("n'utilise pas une voix d'une autre langue", () => {
    expect(voiceScore({ name: "Microsoft Zira Desktop", lang: "en-US" }, "fr-FR")).toBe(0);
    expect(pickVoice([voices[0]], "fr-FR", null)).toBeUndefined();
  });
});
