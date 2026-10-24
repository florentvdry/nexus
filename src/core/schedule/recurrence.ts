/**
 * Quand une tâche programmée s'exécute. Trois formes seulement : une fois, chaque jour, chaque semaine. Les heures sont
 * locales à la machine (le fuseau de Windows), comme l'heure affichée à l'utilisateur.
 */
export type Recurrence =
  | { kind: "once"; at: number }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; weekday: number; time: string };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** « 09:30 » → heures et minutes, ou `null` si l'heure n'est pas valide. */
export function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = time.match(TIME);
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null;
}

/** Prochaine exécution strictement après `now`, en millisecondes. `null` : plus d'exécution prévue. */
export function nextRunAfter(recurrence: Recurrence, now: number): number | null {
  if (recurrence.kind === "once") return recurrence.at > now ? recurrence.at : null;
  const time = parseTime(recurrence.time);
  if (!time) return null;
  const base = new Date(now);
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, time.hours, time.minutes, 0, 0);
    if (recurrence.kind === "weekly" && candidate.getDay() !== recurrence.weekday) continue;
    if (candidate.getTime() > now) return candidate.getTime();
  }
  return null;
}

/** Description lisible d'une récurrence, pour la confirmation et la liste. */
export function describeRecurrence(recurrence: Recurrence): string {
  if (recurrence.kind === "once") return new Date(recurrence.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  if (recurrence.kind === "daily") return `chaque jour à ${recurrence.time}`;
  return `chaque ${WEEKDAYS[recurrence.weekday]} à ${recurrence.time}`;
}

export const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
