import { beforeEach, describe, expect, it } from "vitest";

import { MAX_SAMPLES, operationStats, percentile, recordCall, resetStats } from "./metrics";

describe("mesures locales des appels", () => {
  beforeEach(() => resetStats());

  it("donne le rang de la médiane et du 95e centile", () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(100);
    expect(percentile([], 50)).toBe(0);
  });

  it("compte les appels et leurs échecs, par commande, les plus utilisées d'abord", () => {
    recordCall("ollama_status", 12, true);
    recordCall("ollama_status", 30, false);
    recordCall("processes_list", 5, true);
    const [first, second] = operationStats();
    expect(first).toMatchObject({ command: "ollama_status", count: 2, failures: 1 });
    expect(second).toMatchObject({ command: "processes_list", count: 1, failures: 0 });
  });

  it("ne garde que les mesures les plus récentes, sans grossir indéfiniment", () => {
    for (let index = 0; index < MAX_SAMPLES + 50; index += 1) recordCall("web_search", index, true);
    const [stats] = operationStats();
    expect(stats.count).toBe(MAX_SAMPLES + 50);
    // Les 200 dernières mesures sont 50 à 249 : la médiane est 149.
    expect(stats.p50Ms).toBe(149);
  });

  it("une durée négative ou fractionnaire devient un entier positif", () => {
    recordCall("x", -4, true);
    recordCall("x", 2.6, true);
    expect(operationStats()[0].p95Ms).toBe(3);
  });
});
