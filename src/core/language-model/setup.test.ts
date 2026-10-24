import { describe, expect, it } from "vitest";

import type { TierResult } from "./benchmark";
import { describeTier, nextStep, previousStep, stepNumber, tierForMode } from "./setup";

const result = (tier: TierResult["tier"], passed: number, averageSeconds: number): TierResult => ({ tier, passed, total: 20, averageSeconds });

describe("ordre du parcours de premier lancement", () => {
  it("enchaîne profil, mode puis installation, sans étape pour passer", () => {
    expect(nextStep("profile")).toBe("mode");
    expect(nextStep("mode")).toBe("download");
    expect(nextStep("download")).toBe("download");
  });

  it("revient en arrière jusqu'au profil", () => {
    expect(previousStep("download")).toBe("mode");
    expect(previousStep("profile")).toBe("profile");
  });

  it("compte trois étapes", () => {
    expect(stepNumber("mode")).toEqual({ index: 2, total: 3 });
  });
});

describe("niveau retenu selon le mode", () => {
  it("automatique : le test décide", () => {
    const results = [result("precise", 19, 2.5), result("light", 15, 0.4)];
    expect(tierForMode("automatic", ["precise", "light"], results)).toBe("precise");
  });

  it("plus rapide : le niveau léger, seulement s'il est disponible", () => {
    expect(tierForMode("faster", ["balanced", "light"], [])).toBe("light");
    expect(tierForMode("faster", ["balanced"], [])).toBeNull();
  });

  it("plus précis : le plus précis que la machine peut faire", () => {
    expect(tierForMode("precise", ["precise", "balanced", "light"], [])).toBe("precise");
    expect(tierForMode("precise", ["balanced", "light"], [])).toBe("balanced");
    expect(tierForMode("precise", [], [])).toBeNull();
  });
});

describe("description d'un niveau", () => {
  it("donne la taille du fichier et le nombre de paramètres", () => {
    expect(describeTier("balanced")).toEqual({ parametersBillions: 7, fileGiB: 5 });
  });
});
