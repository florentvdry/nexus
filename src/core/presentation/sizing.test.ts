import { describe, expect, it } from "vitest";

import { MAX_WINDOW_HEIGHT, estimateSize } from "./sizing";

describe("estimateSize", () => {
  it("grandit avec les valeurs longues, sans dépasser la hauteur maximale", () => {
    const short = estimateSize({ kind: "information-card", title: "t", rows: [{ label: "a", value: "b" }] });
    const long = estimateSize({ kind: "information-card", title: "t", rows: [{ label: "a", value: "x".repeat(200) }] });
    expect(long.height).toBeGreaterThan(short.height);
    const many = estimateSize({ kind: "information-card", title: "t", rows: Array.from({ length: 40 }, () => ({ label: "a", value: "b" })) });
    expect(many.height).toBe(MAX_WINDOW_HEIGHT);
  });
});
