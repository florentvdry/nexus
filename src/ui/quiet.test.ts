// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { applyQuiet, readQuiet } from "./quiet";

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.quiet;
});

describe("mode discret", () => {
  it("est désactivé par défaut", () => {
    expect(readQuiet()).toBe(false);
  });

  it("se pose sur la racine et se retient", () => {
    applyQuiet(true);
    expect(document.documentElement.dataset.quiet).toBe("true");
    expect(readQuiet()).toBe(true);
  });

  it("se retire proprement", () => {
    applyQuiet(true);
    applyQuiet(false);
    expect(document.documentElement.dataset.quiet).toBeUndefined();
    expect(readQuiet()).toBe(false);
  });
});
