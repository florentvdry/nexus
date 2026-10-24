import { describe, expect, it, vi } from "vitest";

import { scriptedBridge, TEST_MODEL } from "../testing/scripted";
import { createEngine, type EngineEvent } from "./engine";

const NATIVE = { systemInfo: vi.fn(), launchApp: vi.fn() };
const QUESTION = "qu'est-ce qui est affiché à l'écran ?";

function setup(models: string[]) {
  const screenCapture = vi.fn(async () => "AAAA");
  const visionAsk = vi.fn(async () => "Un bouton « Enregistrer » en bas à droite.");
  const bridge = scriptedBridge(
    { [QUESTION]: { type: "SCREEN_VIEW", question: "Que vois-tu à l'écran ?" }, oui: { type: "UNKNOWN", text: "oui" }, non: { type: "UNKNOWN", text: "non" } },
    { ollamaStatus: vi.fn(async () => ({ reachable: true, models: models.map((name) => ({ name, sizeBytes: 1, parameterSize: null })) })), screenCapture, visionAsk },
  );
  const engine = createEngine({ native: NATIVE, bridge, osint: { run: vi.fn() }, model: () => TEST_MODEL, locale: "fr", responseHoldMs: 0, routineStorage: undefined });
  const events: EngineEvent[] = [];
  engine.subscribe((event) => events.push(event));
  const assistant = () => events.flatMap((event) => (event.type === "message" && event.role === "assistant" ? [event.text] : []));
  return { engine, assistant, screenCapture, visionAsk, events };
}

describe("question sur l'écran : confirmation, une capture, lecture locale", () => {
  it("sans modèle de vision, rien n'est capturé et NEXUS dit comment en installer un", async () => {
    const { engine, assistant, screenCapture } = setup(["qwen2.5:7b"]);
    await engine.submit(QUESTION);
    expect(screenCapture).not.toHaveBeenCalled();
    expect(assistant().join(" ")).toContain("ollama pull qwen2.5vl:3b");
  });

  it("avec un modèle de vision, NEXUS demande d'abord, et ne capture pas sans « oui »", async () => {
    const { engine, assistant, screenCapture } = setup(["qwen2.5:7b", "qwen2.5vl:3b"]);
    await engine.submit(QUESTION);
    expect(assistant().join(" ")).toContain("Confirmer ?");
    await engine.submit("non");
    expect(screenCapture).not.toHaveBeenCalled();
    expect(assistant().at(-1)).toContain("je ne regarde pas l'écran");
  });

  it("« oui » fait une seule capture, l'affiche, et la donne au modèle de vision", async () => {
    const { engine, assistant, screenCapture, visionAsk, events } = setup(["qwen2.5vl:3b"]);
    await engine.submit(QUESTION);
    await engine.submit("oui");
    expect(screenCapture).toHaveBeenCalledTimes(1);
    expect(visionAsk).toHaveBeenCalledWith("qwen2.5vl:3b", "Que vois-tu à l'écran ?", "AAAA");
    expect(events).toContainEqual(expect.objectContaining({ type: "present", content: expect.objectContaining({ kind: "image-card", imageUrl: "data:image/png;base64,AAAA" }) }));
    expect(assistant().at(-1)).toContain("Enregistrer");
  });
});

describe("réponse du modèle : la question peut arriver sous « query »", () => {
  it("SCREEN_VIEW avec « query » est reconnu", async () => {
    const bridge = scriptedBridge({ "regarde mon écran": { type: "SCREEN_VIEW", query: "Que vois-tu ?" } }, { ollamaStatus: vi.fn(async () => ({ reachable: true, models: [] })) });
    const engine = createEngine({ native: NATIVE, bridge, osint: { run: vi.fn() }, model: () => TEST_MODEL, locale: "fr", responseHoldMs: 0, routineStorage: undefined });
    const events: EngineEvent[] = [];
    engine.subscribe((event) => events.push(event));
    await engine.submit("regarde mon écran");
    expect(events.flatMap((event) => (event.type === "message" && event.role === "assistant" ? [event.text] : [])).join(" ")).toContain("qwen2.5vl");
  });
});
