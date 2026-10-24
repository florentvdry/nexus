import { describe, expect, it, vi } from "vitest";

import { scriptedBridge, TEST_MODEL } from "../testing/scripted";
import { createEngine, type EngineEvent } from "./engine";

const NATIVE = { systemInfo: vi.fn(), launchApp: vi.fn(), listApps: vi.fn(async () => []) };

/** Un agenda avec un rendez-vous aujourd'hui à 10 h, et un autre demain. */
function agendaText(): string {
  const today = new Date();
  const stamp = (day: number, hour: number) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + day, hour, 0, 0);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(hour)}0000`;
  };
  return [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "SUMMARY:Revue de projet",
    `DTSTART:${stamp(0, 10)}`,
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:Demain seulement",
    `DTSTART:${stamp(1, 9)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function setup(answers: Record<string, unknown>, agendaPath: string | null, overrides = {}) {
  const bridge = scriptedBridge(answers, { agendaRead: vi.fn(async () => agendaText()), ...overrides });
  const engine = createEngine({
    native: NATIVE,
    bridge,
    osint: { run: vi.fn() },
    model: () => TEST_MODEL,
    locale: "fr",
    responseHoldMs: 0,
    routineStorage: undefined,
    agendaPath: () => agendaPath,
  });
  const events: EngineEvent[] = [];
  engine.subscribe((event) => events.push(event));
  const assistant = () => events.flatMap((event) => (event.type === "message" && event.role === "assistant" ? [event.text] : []));
  const presented = () => events.flatMap((event) => (event.type === "present" ? [event.content] : []));
  return { engine, bridge, assistant, presented };
}

describe("agenda du jour", () => {
  it("affiche les rendez-vous d'aujourd'hui, et seulement ceux-là", async () => {
    const { engine, bridge, presented } = setup({ "qu'est-ce que j'ai aujourd'hui ?": { type: "AGENDA_TODAY" } }, "C:\\Users\\ana\\agenda.ics");
    await engine.submit("qu'est-ce que j'ai aujourd'hui ?");
    expect(bridge.agendaRead).toHaveBeenCalledWith("C:\\Users\\ana\\agenda.ics");
    const table = presented().find((content) => content.kind === "data-table");
    expect(table).toMatchObject({ kind: "data-table", rows: [["10:00", "Revue de projet"]] });
  });

  it("sans fichier désigné, NEXUS le dit et ne lit rien", async () => {
    const { engine, bridge, assistant } = setup({ "qu'est-ce que j'ai aujourd'hui ?": { type: "AGENDA_TODAY" } }, null);
    await engine.submit("qu'est-ce que j'ai aujourd'hui ?");
    expect(bridge.agendaRead).not.toHaveBeenCalled();
    expect(assistant().join(" ")).toContain("Aucun agenda");
  });
});

describe("brouillon de message", () => {
  it("affiche un brouillon à copier, sans rien envoyer", async () => {
    const { engine, presented, assistant } = setup(
      { "écris à Anthony que je serai en retard": { type: "DRAFT_MESSAGE", recipient: "Anthony", text: "Je serai en retard." } },
      null,
    );
    await engine.submit("écris à Anthony que je serai en retard");
    expect(presented()).toContainEqual(expect.objectContaining({ kind: "draft", recipient: "Anthony", text: "Je serai en retard." }));
    expect(presented().find((content) => content.kind === "draft")).toMatchObject({ note: expect.stringContaining("rien n'a été envoyé") });
    expect(assistant()).toContain("Voici un brouillon, prêt à copier.");
  });
});
