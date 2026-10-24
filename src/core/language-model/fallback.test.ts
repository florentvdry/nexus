import { describe, expect, it, vi } from "vitest";

import { fallbackClassifier } from "./classifier";

describe("repli : NIM d'abord, le modèle local ensuite", () => {
  it("si le premier échoue (quota, réseau), le second répond", async () => {
    const primary = { classify: vi.fn(async () => Promise.reject(new Error("quota dépassé"))) };
    const fallback = { classify: vi.fn(async () => ({ type: "HELP" })) };
    expect(await fallbackClassifier(primary, fallback).classify("aide")).toEqual({ type: "HELP" });
    expect(fallback.classify).toHaveBeenCalledTimes(1);
  });

  it("si le premier répond, le second n'est pas appelé", async () => {
    const primary = { classify: vi.fn(async () => ({ type: "SYSTEM_INFO" })) };
    const fallback = { classify: vi.fn(async () => ({ type: "HELP" })) };
    expect(await fallbackClassifier(primary, fallback).classify("cpu")).toEqual({ type: "SYSTEM_INFO" });
    expect(fallback.classify).not.toHaveBeenCalled();
  });
});
