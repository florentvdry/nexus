// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { applyTheme, readTheme } from "./theme";

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("thème de l'interface", () => {
  it("suit Windows quand rien n'a été choisi", () => {
    expect(readTheme()).toBe("system");
  });

  it("retient le choix et le pose sur la racine", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(readTheme()).toBe("light");
  });

  it("revenir à « suivre Windows » retire l'attribut", () => {
    applyTheme("dark");
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(readTheme()).toBe("system");
  });

  it("une valeur inconnue stockée retombe sur Windows", () => {
    window.localStorage.setItem("nexus.theme", "rose");
    expect(readTheme()).toBe("system");
  });
});
