import { describe, expect, it, vi } from "vitest";

import { NeuralSpeechOutput, type PlaybackContext } from "./neural-output";
import type { SpeakOptions, SpeechOutput } from "./types";

const OPTIONS: SpeakOptions = { locale: "fr", rate: 1, volume: 0.8, voiceName: null };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeFallback() {
  const fallback: SpeechOutput = { available: true, speak: vi.fn<(text: string, options: SpeakOptions) => void>(), cancel: vi.fn<() => void>() };
  return fallback as SpeechOutput & { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
}

function fakeContext() {
  const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; onended: unknown; buffer: unknown }[] = [];
  const context = {
    decodeAudioData: vi.fn(async () => ({ duration: 1 }) as AudioBuffer),
    createBufferSource: vi.fn(() => {
      const source = { start: vi.fn(), stop: vi.fn(), connect: vi.fn(), onended: null, buffer: null as unknown };
      sources.push(source);
      return source as unknown as AudioBufferSourceNode;
    }),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() }) as unknown as GainNode),
    destination: {} as AudioDestinationNode,
    currentTime: 0,
    resume: vi.fn(async () => {}),
  };
  return { context: context as unknown as PlaybackContext & typeof context, sources };
}

describe("voix naturelle", () => {
  it("synthétise la réponse phrase par phrase, puis la joue", async () => {
    const source = { installed: vi.fn(async () => true), synthesize: vi.fn(async () => btoa("RIFF")) };
    const { context, sources } = fakeContext();
    const fallback = fakeFallback();
    const output = new NeuralSpeechOutput(source, fallback, () => context);

    output.speak("Bonjour.\nSources : https://example.org/a", { ...OPTIONS, rate: 1.2 });
    await flush();

    expect(source.synthesize).toHaveBeenCalledWith("Bonjour.", 1.2);
    expect(context.decodeAudioData).toHaveBeenCalled();
    expect(sources[0].start).toHaveBeenCalled();
    expect(fallback.speak).not.toHaveBeenCalled();
  });

  it("sans voix installée, la voix Windows lit la réponse", async () => {
    const source = { installed: vi.fn(async () => false), synthesize: vi.fn() };
    const fallback = fakeFallback();
    const output = new NeuralSpeechOutput(source, fallback, () => fakeContext().context);

    output.speak("Bonjour.", OPTIONS);
    await flush();

    expect(source.synthesize).not.toHaveBeenCalled();
    expect(fallback.speak).toHaveBeenCalledWith("Bonjour.", OPTIONS);
  });

  it("si la synthèse échoue, la voix Windows prend le relais", async () => {
    const source = {
      installed: vi.fn(async () => true),
      synthesize: vi.fn(async () => {
        throw new Error("moteur indisponible");
      }),
    };
    const fallback = fakeFallback();
    const output = new NeuralSpeechOutput(source, fallback, () => fakeContext().context);

    output.speak("Bonjour.", OPTIONS);
    await flush();

    expect(fallback.speak).toHaveBeenCalledWith("Bonjour.", OPTIONS);
  });

  it("l'anglais reste sur la voix Windows, sans synthèse", () => {
    const source = { installed: vi.fn(async () => true), synthesize: vi.fn() };
    const fallback = fakeFallback();
    const output = new NeuralSpeechOutput(source, fallback, () => fakeContext().context);

    output.speak("Hello.", { ...OPTIONS, locale: "en" });

    expect(source.synthesize).not.toHaveBeenCalled();
    expect(fallback.speak).toHaveBeenCalled();
  });

  it("annuler avant la fin de la synthèse : rien n'est joué", async () => {
    let finish: (value: string) => void = () => {};
    const source = { installed: vi.fn(async () => true), synthesize: vi.fn(() => new Promise<string>((resolve) => (finish = resolve))) };
    const { context, sources } = fakeContext();
    const fallback = fakeFallback();
    const output = new NeuralSpeechOutput(source, fallback, () => context);

    output.speak("Bonjour.", OPTIONS);
    await flush();
    output.cancel();
    finish(btoa("RIFF"));
    await flush();

    expect(sources).toHaveLength(0);
    expect(fallback.cancel).toHaveBeenCalled();
  });

  it("un texte sans phrase lisible n'appelle rien", () => {
    const source = { installed: vi.fn(async () => true), synthesize: vi.fn() };
    const output = new NeuralSpeechOutput(source, fakeFallback(), () => fakeContext().context);
    output.speak("  ...  ", OPTIONS);
    expect(source.installed).not.toHaveBeenCalled();
  });
});
