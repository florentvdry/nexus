import { useEffect, useState } from "react";

import type { Engine } from "../core/engine/engine";
import { VoiceController } from "../core/voice/controller";
import { NeuralSpeechOutput } from "../core/voice/neural-output";
import { createSpeechInput } from "../../plugins/speech/whisper-stt";
import { WebSpeechOutput } from "../../plugins/speech/system-tts";
import { createNativeBridge } from "../core/native/bridge";
import type { VoiceSettings } from "../core/voice/settings";
import type { VoiceStatus } from "../core/voice/types";

// Un seul contrôleur par moteur : React peut monter les composants deux fois en développement,
// et un second contrôleur écouterait les mêmes événements en double.
const controllers = new WeakMap<Engine, VoiceController>();

/** Voix naturelle locale (Piper), une par langue ; la voix Windows prend le relais. */
function speechOutput() {
  const bridge = createNativeBridge();
  return new NeuralSpeechOutput(
    {
      installed: (locale) => bridge.speechNeuralAvailable(locale),
      synthesize: (text, rate, locale) => bridge.speechNeuralSpeak(text, rate, locale),
    },
    new WebSpeechOutput(),
    () => new AudioContext(),
  );
}

function controllerFor(engine: Engine, settings: () => VoiceSettings): VoiceController {
  let controller = controllers.get(engine);
  if (!controller) {
    controller = new VoiceController({ engine, input: createSpeechInput(), output: speechOutput(), settings });
    controllers.set(engine, controller);
  }
  return controller;
}

export function useVoice(engine: Engine, settings: () => VoiceSettings) {
  const controller = controllerFor(engine, settings);
  const [status, setStatus] = useState<VoiceStatus>(controller.status);

  useEffect(() => controller.subscribe(setStatus), [controller]);

  return { controller, status };
}
