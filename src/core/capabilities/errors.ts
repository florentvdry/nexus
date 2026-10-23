import { NativeCallError, NativeUnavailableError } from "../native/adapter";

export type CapabilityErrorCode =
  | "unknown-capability"
  | "disabled"
  | "permission-denied"
  | "confirmation-required"
  | "timeout"
  | "cancelled"
  | "plugin-failure"
  | "native-unavailable"
  | "not-installed"
  | "launch-failed"
  | "unknown-app"
  | "task-failed";

/** Erreur contrôlée d'une capacité. Le code sert à la traduction ; les paramètres la complètent. */
export class CapabilityError extends Error {
  constructor(
    readonly code: CapabilityErrorCode | string,
    readonly params: Record<string, string> = {},
  ) {
    super(code);
    this.name = "CapabilityError";
  }
}

/** Convertit toute erreur inattendue en erreur contrôlée : un plugin ne fait jamais tomber JARVIS. */
export function toCapabilityError(error: unknown): CapabilityError {
  if (error instanceof CapabilityError) return error;
  if (error instanceof NativeCallError) return new CapabilityError(error.code, { details: error.message, name: error.message });
  if (error instanceof NativeUnavailableError) return new CapabilityError("native-unavailable");
  return new CapabilityError("plugin-failure");
}
