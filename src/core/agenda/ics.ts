/**
 * Agenda au format iCalendar (.ics), lu en lecture seule. Couvre les rendez-vous ponctuels, à heure ou sur la journée.
 * Les récurrences (RRULE) ne sont pas encore développées : un rendez-vous récurrent apparaît à sa première date.
 */

export interface AgendaEvent {
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
}

/** Lignes d'un fichier iCalendar, dépliées (une ligne commençant par un espace prolonge la précédente). */
export function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else if (raw.length > 0) {
      lines.push(raw);
    }
  }
  return lines;
}

/** Valeur d'une date iCalendar : 20261025T090000 (local), …Z (UTC), ou 20261025 (journée entière). */
export function parseIcsDate(value: string): { date: Date; allDay: boolean } | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!match) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00", utc] = match;
  const parts = [Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)] as const;
  const date = utc ? new Date(Date.UTC(...parts)) : new Date(...parts);
  return Number.isNaN(date.getTime()) ? null : { date, allDay: !match[4] };
}

/** Rendez-vous d'un fichier .ics. Un événement sans date de début, ou au format inconnu, est ignoré. */
export function parseIcs(text: string): AgendaEvent[] {
  const events: AgendaEvent[] = [];
  let current: Partial<Record<"SUMMARY" | "DTSTART" | "DTEND", string>> | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      current = {};
    } else if (line === "END:VEVENT") {
      const start = current?.DTSTART ? parseIcsDate(current.DTSTART) : null;
      if (current && start) {
        const end = current.DTEND ? parseIcsDate(current.DTEND) : null;
        events.push({
          title: (current.SUMMARY ?? "(sans titre)").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, " ").trim(),
          start: start.date,
          end: end?.date ?? null,
          allDay: start.allDay,
        });
      }
      current = null;
    } else if (current) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      // « DTSTART;TZID=Europe/Paris:… » : seul le nom avant le « ; » compte.
      const name = line.slice(0, separator).split(";")[0].toUpperCase();
      if (name === "SUMMARY" || name === "DTSTART" || name === "DTEND") current[name] = line.slice(separator + 1);
    }
  }
  return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Rendez-vous qui tombent le jour de `day` (date locale). */
export function eventsOn(events: readonly AgendaEvent[], day: Date): AgendaEvent[] {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  // Le lendemain se calcule par la date du calendrier : 24 h en millisecondes décaleraient le changement d'heure.
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  return events.filter((event) => {
    const start = event.start.getTime();
    return start >= from && start < to;
  });
}
