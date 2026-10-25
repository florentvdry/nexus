import { describe, expect, it } from "vitest";

import { isQuietHour } from "./engine";

describe("plage silencieuse", () => {
  it("couvre la nuit, de 22 h à 7 h", () => {
    expect(isQuietHour(new Date(2026, 9, 25, 23, 30))).toBe(true);
    expect(isQuietHour(new Date(2026, 9, 25, 3, 0))).toBe(true);
    expect(isQuietHour(new Date(2026, 9, 25, 22, 0))).toBe(true);
  });

  it("laisse passer la journée", () => {
    expect(isQuietHour(new Date(2026, 9, 25, 7, 0))).toBe(false);
    expect(isQuietHour(new Date(2026, 9, 25, 14, 0))).toBe(false);
    expect(isQuietHour(new Date(2026, 9, 25, 21, 59))).toBe(false);
  });
});
