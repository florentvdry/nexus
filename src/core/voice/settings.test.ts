import { describe, expect, it } from "vitest";

import { DEFAULT_VOICE_SETTINGS, parseVoiceSettings, readVoiceSettings, writeVoiceSettings } from "./settings";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("réglages vocaux", () => {
  it("revient aux valeurs par défaut quand le stockage est corrompu", () => {
    expect(readVoiceSettings(memoryStorage({ "nexus.voice": "{pas du json" }))).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("rejette les valeurs hors domaine", () => {
    const parsed = parseVoiceSettings({ language: "de", volume: 4, rate: 0.01, enabled: "oui" });
    expect(parsed).toEqual({ ...DEFAULT_VOICE_SETTINGS, volume: 1, rate: 0.5 });
  });

  it("relit ce qui a été écrit", () => {
    const storage = memoryStorage();
    const settings = { ...DEFAULT_VOICE_SETTINGS, enabled: false, language: "en" as const, spokenReplies: true };
    writeVoiceSettings(settings, storage);
    expect(readVoiceSettings(storage)).toEqual(settings);
  });

  it("ne plante pas quand le stockage est indisponible", () => {
    expect(readVoiceSettings(undefined)).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(() => writeVoiceSettings(DEFAULT_VOICE_SETTINGS, undefined)).not.toThrow();
  });
});
