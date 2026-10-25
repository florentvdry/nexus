// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { readOfflineStrict, readNimSettings, readOnlineModel, writeNimSettings, writeOfflineStrict } from "./nimSettings";

afterEach(() => {
  window.localStorage.clear();
});

describe("mode strict hors ligne", () => {
  it("coupe toute demande vers NVIDIA, même si NIM est coché", () => {
    writeNimSettings({ ...readNimSettings(), enabled: true });
    expect(readOnlineModel()).not.toBeNull();
    writeOfflineStrict(true);
    expect(readOfflineStrict()).toBe(true);
    expect(readOnlineModel()).toBeNull();
  });

  it("l'activer décoche NIM, et le désactiver ne le réactive pas", () => {
    writeNimSettings({ ...readNimSettings(), enabled: true });
    writeOfflineStrict(true);
    expect(readNimSettings().enabled).toBe(false);
    writeOfflineStrict(false);
    expect(readNimSettings().enabled).toBe(false);
  });
});
