import { useEffect, useState } from "react";

import type { Engine } from "../core/engine/engine";
import { VoiceController } from "../core/voice/controller";
import { createSpeechInput } from "../../plugins/speech/whisper-stt";
import { WebSpeechOutput } from "../../plugins/speech/system-tts";
import type { VoiceSettings } from "../core/voice/settings";
import type { VoiceStatus } from "../core/voice/types";

// Un seul contrôleur par moteur : React peut monter les composants deux fois en développement,
// et un second contrôleur écouterait les mêmes événements en double.
const controllers = new WeakMap<Engine, VoiceController>();

function controllerFor(engine: Engine, settings: () => VoiceSettings): VoiceController {
  let controller = controllers.get(engine);
  if (!controller) {
    controller = new VoiceController({ engine, input: createSpeechInput(), output: new WebSpeechOutput(), settings });
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
