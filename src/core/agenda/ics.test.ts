import { describe, expect, it } from "vitest";

import { eventsOn, parseIcs, parseIcsDate, unfold } from "./ics";

const SAMPLE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "SUMMARY:Point d'équipe\\, salle 3",
  "DTSTART;TZID=Europe/Paris:20261025T093000",
  "DTEND;TZID=Europe/Paris:20261025T100000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY:Anniversaire",
  "DTSTART;VALUE=DATE:20261025",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY:Autre jour",
  "DESCRIPTION:une longue",
  " description repliée",
  "DTSTART:20261026T120000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY:Sans date",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("lecture d'un agenda iCalendar", () => {
  it("déplie les lignes repliées", () => {
    expect(unfold("DESCRIPTION:une longue \r\n description repliée")).toEqual(["DESCRIPTION:une longue description repliée"]);
  });

  it("lit les dates locales, UTC et journée entière", () => {
    expect(parseIcsDate("20261025T093000")?.date.getHours()).toBe(9);
    expect(parseIcsDate("20261025T093000Z")?.date.getUTCHours()).toBe(9);
    expect(parseIcsDate("20261025")?.allDay).toBe(true);
    expect(parseIcsDate("pas une date")).toBeNull();
  });

  it("garde les rendez-vous datés, avec leur titre nettoyé, triés par heure", () => {
    const events = parseIcs(SAMPLE);
    expect(events.map((event) => event.title)).toEqual(["Anniversaire", "Point d'équipe, salle 3", "Autre jour"]);
    expect(events[1].end?.getHours()).toBe(10);
    expect(events.find((event) => event.title === "Sans date")).toBeUndefined();
  });

  it("ne retient que les rendez-vous du jour demandé", () => {
    const events = parseIcs(SAMPLE);
    const titles = eventsOn(events, new Date(2026, 9, 25, 15, 0)).map((event) => event.title);
    expect(titles).toEqual(["Anniversaire", "Point d'équipe, salle 3"]);
  });
});
