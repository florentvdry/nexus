import { describe, expect, it, vi } from "vitest";

import { createEngine, type EngineEvent } from "../engine/engine";
import { NativeCallError, NativeUnavailableError, type NativeAdapter } from "../native/adapter";
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from "./settings";
import { VoiceController } from "./controller";
import type { SpeakOptions, SpeechInput, SpeechOutput, VoiceEvent } from "./types";

// Doubles de test : le micro et la synthèse vocale sont simulés. Rien ici n'est une donnée réelle.
class TestSpeechInput implements SpeechInput {
  readonly start = vi.fn(async (_language: string | undefined) => {});
  readonly stop = vi.fn(async () => {});
  private readonly events = new Set<(event: VoiceEvent) => void>();
  private readonly toggles = new Set<() => void>();

  onEvent(listener: (event: VoiceEvent) => void) {
    this.events.add(listener);
    return () => this.events.delete(listener);
  }

  onToggleRequest(listener: () => void) {
    this.toggles.add(listener);
    return () => this.toggles.delete(listener);
  }

  emit(event: VoiceEvent) {
    for (const listener of this.events) listener(event);
  }

  requestToggle() {
    for (const listener of this.toggles) listener();
  }
}

class TestSpeechOutput implements SpeechOutput {
  available = true;
  readonly spoken: { text: string; options: SpeakOptions }[] = [];
  cancelled = 0;

  speak(text: string, options: SpeakOptions) {
    this.spoken.push({ text, options });
  }

  cancel() {
    this.cancelled += 1;
  }
}

function nativeDouble(overrides: Partial<NativeAdapter> = {}): NativeAdapter {
  return {
    systemInfo: vi.fn(),
    launchApp: vi.fn(async (appId: string) => ({ appId, displayName: appId, pid: 1 })),
    listApps: vi.fn(async () => []),
    ...overrides,
  };
}

function setup(settings: Partial<VoiceSettings> = {}, native = nativeDouble()) {
  const engine = createEngine({ native, locale: "fr", responseHoldMs: 0 });
  const messages: Extract<EngineEvent, { type: "message" }>[] = [];
  engine.subscribe((event) => {
    if (event.type === "message") messages.push(event);
  });
  const input = new TestSpeechInput();
  const output = new TestSpeechOutput();
  const current = { ...DEFAULT_VOICE_SETTINGS, ...settings };
  const controller = new VoiceController({ engine, input, output, settings: () => current });
  return { engine, input, output, controller, messages, native, current };
}

const assistantTexts = (messages: { role: string; text: string }[]) =>
  messages.filter((message) => message.role === "assistant").map((message) => message.text);

describe("VoiceController", () => {
  it("démarre l'écoute, puis l'arrête au second basculement", async () => {
    const { controller, input } = setup();
    await controller.toggle();
    expect(input.start).toHaveBeenCalledWith(undefined);
    expect(controller.status).toBe("listening");

    await controller.toggle();
    expect(input.stop).toHaveBeenCalledOnce();
    expect(controller.status).toBe("off");
  });

  it("force la langue de reconnaissance quand l'utilisateur la choisit", async () => {
    const { controller, input } = setup({ language: "en" });
    await controller.start();
    expect(input.start).toHaveBeenCalledWith("en");
  });

  it("n'ouvre jamais le micro quand les fonctions vocales sont désactivées", async () => {
    const { controller, input, messages } = setup({ enabled: false });
    await controller.start();
    expect(input.start).not.toHaveBeenCalled();
    expect(assistantTexts(messages)).toEqual(["Les fonctions vocales sont désactivées. Tu peux les réactiver dans les réglages vocaux."]);
  });

  it("transforme une transcription française en commande et répond en français", async () => {
    const { controller, input, native, messages } = setup();
    await controller.start();
    input.emit({ kind: "transcript", text: "lance discord", language: "fr" });

    await vi.waitFor(() => expect(assistantTexts(messages)).toContain("Discord est ouvert."));
    expect(native.launchApp).toHaveBeenCalledWith("discord");
  });

  it("répond en anglais à une transcription anglaise", async () => {
    const { controller, input, messages } = setup();
    await controller.start();
    input.emit({ kind: "transcript", text: "open discord", language: "en" });
    await vi.waitFor(() => expect(assistantTexts(messages)).toContain("Discord is open."));
  });

  it("respecte la langue de réponse imposée par les réglages", async () => {
    const { controller, input, messages } = setup({ language: "en" });
    await controller.start();
    input.emit({ kind: "transcript", text: "lance discord", language: "fr" });
    await vi.waitFor(() => expect(assistantTexts(messages)).toContain("Discord is open."));
  });

  it("en mode « après une commande vocale », ne lit que les réponses aux commandes dites", async () => {
    const { controller, input, output } = setup({ replyMode: "voice" });
    controller.submitText("affiche les ressources");
    expect(output.spoken).toHaveLength(0);

    await controller.start();
    input.emit({ kind: "transcript", text: "lance discord", language: "fr" });
    await vi.waitFor(() => expect(output.spoken.length).toBeGreaterThan(0));
    expect(output.spoken[0].options.locale).toBe("fr");
  });

  it("lit les réponses à voix haute seulement si le mode l'autorise", async () => {
    const quiet = setup({ replyMode: "off" });
    quiet.engine.say("Bonjour");
    expect(quiet.output.spoken).toHaveLength(0);

    const spoken = setup({ replyMode: "always", rate: 1.2, volume: 0.5 });
    spoken.engine.say("Bonjour");
    expect(spoken.output.spoken).toEqual([
      { text: "Bonjour", options: { locale: "fr", rate: 1.2, volume: 0.5, voiceName: null } },
    ]);
  });

  it("interrompt la lecture dès que l'utilisateur reprend la parole", async () => {
    const { controller, input, output } = setup({ replyMode: "always" });
    await controller.start();
    const before = output.cancelled;
    input.emit({ kind: "speech-started" });
    expect(output.cancelled).toBeGreaterThan(before);
  });

  it("interrompt la lecture quand une nouvelle commande texte est envoyée", () => {
    const { controller, output } = setup({ replyMode: "always" });
    const before = output.cancelled;
    controller.submitText("affiche les ressources");
    expect(output.cancelled).toBeGreaterThan(before);
  });

  it("affiche un message localisé quand le modèle de reconnaissance manque", async () => {
    const native = nativeDouble();
    const { controller, input, messages } = setup({}, native);
    input.start.mockRejectedValueOnce(new NativeCallError("model-missing", "chemin"));
    await controller.start();
    expect(controller.status).toBe("off");
    expect(assistantTexts(messages).at(-1)).toContain("modèle de reconnaissance vocale est absent");
  });

  it("signale l'absence de backend natif hors application de bureau", async () => {
    const { controller, input, messages } = setup();
    input.start.mockRejectedValueOnce(new NativeUnavailableError());
    await controller.start();
    expect(assistantTexts(messages).at(-1)).toContain("application de bureau NEXUS");
  });

  it("affiche les erreurs remontées pendant l'écoute et revient à l'arrêt à la fin de session", () => {
    const { controller, input, messages } = setup();
    input.emit({ kind: "error", code: "inference", message: "détail technique" });
    expect(assistantTexts(messages).at(-1)).toContain("reconnaissance vocale a échoué");

    input.emit({ kind: "stopped" });
    expect(controller.status).toBe("off");
  });

  it("réagit au raccourci global comme à un clic sur le micro", async () => {
    const { input, controller } = setup();
    input.requestToggle();
    await vi.waitFor(() => expect(controller.status).toBe("listening"));
    input.requestToggle();
    await vi.waitFor(() => expect(controller.status).toBe("off"));
  });
});
