import { describe, expect, it } from "vitest";

import { MIN_DAYS, RoutineDetector, routineKey, routinesEnabled, setRoutinesEnabled, type RoutineStorage } from "./detector";

function memoryStorage(): RoutineStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

/** Horloge déplaçable : une date par jour, à l'heure voulue. */
function clock(start: Date) {
  let current = start;
  return {
    now: () => current,
    on: (day: number, hour: number) => {
      current = new Date(2026, 9, day, hour, 0, 0, 0);
      return current;
    },
  };
}

describe("routines : une habitude repérée, jamais imposée", () => {
  it("ne compare que la forme canonique d'une demande", () => {
    expect(routineKey("  Résume   LES actus ")).toBe("résume les actus");
  });

  it("propose après trois jours distincts à la même heure, une seule fois", () => {
    const time = clock(new Date(2026, 9, 1));
    const detector = new RoutineDetector(memoryStorage(), time.now);
    time.on(20, 8);
    expect(detector.observe("résume les actus")).toBeNull();
    time.on(21, 8);
    expect(detector.observe("résume les actus")).toBeNull();
    time.on(22, 8);
    expect(detector.observe("résume les actus")).toEqual({ request: "résume les actus", hour: 8 });
    time.on(23, 8);
    expect(detector.observe("résume les actus")).toBeNull();
    expect(MIN_DAYS).toBe(3);
  });

  it("ne propose rien si la demande revient à des heures trop éloignées", () => {
    const time = clock(new Date(2026, 9, 1));
    const detector = new RoutineDetector(memoryStorage(), time.now);
    time.on(20, 8);
    detector.observe("résume les actus");
    time.on(21, 18);
    detector.observe("résume les actus");
    time.on(22, 8);
    expect(detector.observe("résume les actus")).toBeNull();
  });

  it("une même journée ne compte qu'une fois", () => {
    const time = clock(new Date(2026, 9, 1));
    const detector = new RoutineDetector(memoryStorage(), time.now);
    time.on(20, 8);
    detector.observe("résume les actus");
    time.on(20, 9);
    detector.observe("résume les actus");
    time.on(20, 10);
    expect(detector.observe("résume les actus")).toBeNull();
  });

  it("les demandes très courtes ne sont jamais des routines", () => {
    const time = clock(new Date(2026, 9, 1));
    const detector = new RoutineDetector(memoryStorage(), time.now);
    for (const day of [20, 21, 22]) {
      time.on(day, 8);
      expect(detector.observe("oui")).toBeNull();
    }
  });

  it("un stockage cassé ne bloque rien : aucune proposition, aucune erreur", () => {
    const broken: RoutineStorage = {
      getItem: () => {
        throw new Error("stockage bloqué");
      },
      setItem: () => {
        throw new Error("stockage bloqué");
      },
    };
    const detector = new RoutineDetector(broken, () => new Date(2026, 9, 20, 8));
    expect(() => detector.observe("résume les actus")).not.toThrow();
  });
});

describe("routines : désactivables", () => {
  it("désactivées, rien n'est observé ni proposé ; réactivées, la détection reprend", () => {
    const storage = memoryStorage();
    const time = clock(new Date(2026, 9, 1));
    const detector = new RoutineDetector(storage, time.now);
    setRoutinesEnabled(storage, false);
    for (const day of [20, 21, 22]) {
      time.on(day, 8);
      expect(detector.observe("résume les actus")).toBeNull();
    }
    expect(routinesEnabled(storage)).toBe(false);
    setRoutinesEnabled(storage, true);
    expect(routinesEnabled(storage)).toBe(true);
  });
});
