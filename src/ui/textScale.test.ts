// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { applyLargeText, readLargeText } from "./textScale";

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.textScale;
});

describe("taille du texte", () => {
  it("normale par défaut, et grande après le réglage", () => {
    expect(readLargeText()).toBe(false);
    applyLargeText(true);
    expect(document.documentElement.dataset.textScale).toBe("large");
    expect(readLargeText()).toBe(true);
  });

  it("revient à normale, et le choix survit au rechargement", () => {
    applyLargeText(true);
    applyLargeText(false);
    expect(document.documentElement.dataset.textScale).toBeUndefined();
    expect(readLargeText()).toBe(false);
  });
});
