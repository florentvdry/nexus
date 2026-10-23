import { describe, expect, it } from "vitest";

import type { TierResult } from "./benchmark";
import { describeTier, nextStep, tierForMode } from "./setup";

const result = (tier: TierResult["tier"], passed: number, averageSeconds: number): TierResult => ({ tier, passed, total: 20, averageSeconds });

describe("ordre du parcours de premier lancement", () => {
  it("enchaîne les étapes puis termine au résumé", () => {
    expect(nextStep("profile")).toBe("mode");
    expect(nextStep("mode")).toBe("download");
    expect(nextStep("download")).toBe("benchmark");
    expect(nextStep("benchmark")).toBe("summary");
    expect(nextStep("summary")).toBe("summary");
  });

  it("laisse toujours passer le parcours, et le passage reste définitif", () => {
    expect(nextStep("skipped")).toBe("skipped");
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
    expect(describeTier("balanced")).toEqual({ parametersBillions: 3, fileGiB: 2 });
  });
});
