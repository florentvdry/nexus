import { describe, expect, it } from "vitest";

import { detectLocale, translate } from "./messages";
import { formatGiB, formatUptime } from "./format";

describe("translate", () => {
  it("remplace les paramètres dans la langue demandée", () => {
    expect(translate("fr", "app.opened", { app: "Discord" })).toBe("Discord est ouvert.");
    expect(translate("en", "app.opened", { app: "Discord" })).toBe("Discord is open.");
  });

  it("conserve le modèle quand un paramètre manque, pour ne jamais afficher une valeur fausse", () => {
    expect(translate("fr", "app.opened")).toBe("{app} est ouvert.");
  });
});

describe("detectLocale", () => {
  it("choisit l'anglais pour les variantes anglaises et le français sinon", () => {
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("fr-FR")).toBe("fr");
    expect(detectLocale("de-DE")).toBe("fr");
    expect(detectLocale(undefined)).toBe("fr");
  });
});

describe("formats", () => {
  it("formate les octets en gigaoctets selon la langue", () => {
    expect(formatGiB("en", 16 * 1024 ** 3)).toBe("16 GB");
    expect(formatGiB("fr", 16 * 1024 ** 3)).toBe("16 Go");
  });

  it("formate la durée de fonctionnement", () => {
    expect(formatUptime("fr", 3725)).toBe("1 h 2 min");
    expect(formatUptime("en", 90000)).toBe("1d 1h 0min");
  });
});
