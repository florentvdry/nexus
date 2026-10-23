import type { VoiceLanguage } from "./types";

export type VoiceLanguageSetting = "auto" | VoiceLanguage;

/**
 * Quand les réponses sont lues à voix haute :
 * `off` jamais · `voice` seulement après une commande vocale · `always` toujours.
 */
export type ReplyMode = "off" | "voice" | "always";

export interface VoiceSettings {
  /** Interrupteur général : désactive le micro, la reconnaissance et la synthèse. */
  enabled: boolean;
  language: VoiceLanguageSetting;
  replyMode: ReplyMode;
  volume: number;
  rate: number;
  voiceName: string | null;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: true,
  language: "auto",
  replyMode: "voice",
  volume: 1,
  rate: 1,
  voiceName: null,
};

const STORAGE_KEY = "nexus.voice";

/** Valide une valeur lue depuis le stockage. Toute valeur invalide revient au réglage par défaut. */
export function parseVoiceSettings(raw: unknown): VoiceSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_VOICE_SETTINGS };
  const value = raw as Record<string, unknown>;
  const language = value.language === "fr" || value.language === "en" || value.language === "auto"
    ? value.language
    : DEFAULT_VOICE_SETTINGS.language;
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_VOICE_SETTINGS.enabled,
    language,
    replyMode: parseReplyMode(value),
    volume: typeof value.volume === "number" ? clamp(value.volume, 0, 1) : DEFAULT_VOICE_SETTINGS.volume,
    rate: typeof value.rate === "number" ? clamp(value.rate, 0.5, 1.5) : DEFAULT_VOICE_SETTINGS.rate,
    voiceName: typeof value.voiceName === "string" ? value.voiceName : null,
  };
}

/** Accepte le mode actuel, et convertit l'ancien réglage booléen `spokenReplies` (phase 2). */
function parseReplyMode(value: Record<string, unknown>): ReplyMode {
  if (value.replyMode === "off" || value.replyMode === "voice" || value.replyMode === "always") return value.replyMode;
  if (typeof value.spokenReplies === "boolean") return value.spokenReplies ? "always" : "off";
  return DEFAULT_VOICE_SETTINGS.replyMode;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function readVoiceSettings(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): VoiceSettings {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    return parseVoiceSettings(stored ? JSON.parse(stored) : undefined);
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function writeVoiceSettings(settings: VoiceSettings, storage: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Stockage indisponible : les réglages restent valables pour la session.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
