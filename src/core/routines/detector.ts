/**
 * Routines : une demande faite le même jour et à peu près à la même heure, sur plusieurs jours, est une habitude.
 * NEXUS la repère et propose de la programmer chaque jour. Il ne programme jamais sans « oui ». Les observations
 * restent sur ce poste (stockage local du navigateur, sans contenu autre que la demande elle-même).
 */

export interface RoutineStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RoutineProposal {
  request: string;
  /** Heure entière proposée pour la routine quotidienne (0 à 23). */
  hour: number;
}

interface Observation {
  days: string[];
  hours: number[];
  proposed: boolean;
}

const KEY = "nexus.routines.v1";
const ENABLED_KEY = "nexus.routines.enabled";
/** Nombre de jours distincts avant de proposer. */
export const MIN_DAYS = 3;
/** Écart maximal, en heures, entre les moments où la demande revient. */
const MAX_SPREAD_HOURS = 1;
const MIN_REQUEST_CHARS = 6;

/** Forme canonique d'une demande pour la comparer : casse et espaces sans importance. */
export function routineKey(request: string): string {
  return request.trim().toLowerCase().replace(/\s+/g, " ");
}

function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function read(storage: RoutineStorage | undefined): Record<string, Observation> {
  try {
    const raw = storage?.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, Observation>) : {};
  } catch {
    return {};
  }
}

function write(storage: RoutineStorage | undefined, data: Record<string, Observation>): void {
  try {
    storage?.setItem(KEY, JSON.stringify(data));
  } catch {
    // Stockage indisponible : les routines ne seront simplement pas repérées.
  }
}

/** Détection des routines activée ? Oui par défaut ; l'utilisateur peut la couper dans les réglages. */
export function routinesEnabled(storage: RoutineStorage | undefined): boolean {
  try {
    return storage?.getItem(ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setRoutinesEnabled(storage: RoutineStorage | undefined, enabled: boolean): void {
  try {
    storage?.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // Stockage indisponible : le réglage revient à sa valeur par défaut au prochain lancement.
  }
}

export class RoutineDetector {
  readonly #storage: RoutineStorage | undefined;
  readonly #now: () => Date;

  constructor(storage: RoutineStorage | undefined, now: () => Date = () => new Date()) {
    this.#storage = storage;
    this.#now = now;
  }

  /**
   * Enregistre une demande. Renvoie une proposition quand la demande revient sur `MIN_DAYS` jours distincts, à une
   * heure stable, et qu'elle n'a pas déjà été proposée.
   */
  observe(request: string): RoutineProposal | null {
    if (!routinesEnabled(this.#storage)) return null;
    const key = routineKey(request);
    if (key.length < MIN_REQUEST_CHARS) return null;
    const data = read(this.#storage);
    const now = this.#now();
    const entry: Observation = data[key] ?? { days: [], hours: [], proposed: false };
    const day = localDay(now);
    if (!entry.days.includes(day)) {
      entry.days.push(day);
      entry.hours.push(now.getHours());
    }
    data[key] = entry;
    write(this.#storage, data);

    if (entry.proposed || entry.days.length < MIN_DAYS) return null;
    const spread = Math.max(...entry.hours) - Math.min(...entry.hours);
    if (spread > MAX_SPREAD_HOURS) return null;
    const hour = Math.round(entry.hours.reduce((total, value) => total + value, 0) / entry.hours.length);
    entry.proposed = true;
    data[key] = entry;
    write(this.#storage, data);
    return { request: request.trim(), hour };
  }
}
