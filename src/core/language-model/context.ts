/**
 * Contexte envoyé au classifieur. Le modèle local le reçoit en entier ; NVIDIA NIM ne reçoit que les catégories que
 * l'utilisateur a cochées. La demande elle-même et l'heure ne sont pas optionnelles : sans elles, rien ne se comprend.
 */
export type ContextShare = "conversation" | "memories" | "shown";

export const CONTEXT_SHARES: readonly ContextShare[] = ["conversation", "memories", "shown"];

export interface ContextParts {
  /** Derniers échanges de la conversation, en une ligne. */
  conversation: string | null;
  /** Souvenirs de l'utilisateur. */
  memories: string[];
  /** Éléments affichés à l'utilisateur (fichiers, pages, applications). */
  shown: string | null;
  /** Date, heure et commandes des plugins : rien de personnel, toujours inclus. */
  system: string[];
}

export function buildContext(parts: ContextParts, share: ReadonlySet<ContextShare>): string[] {
  const context: string[] = [];
  if (share.has("conversation") && parts.conversation) context.push(parts.conversation);
  if (share.has("memories")) context.push(...parts.memories);
  if (share.has("shown") && parts.shown) context.push(parts.shown);
  context.push(...parts.system);
  return context;
}

/** Garde seulement les catégories connues, sans doublon : une préférence corrompue ne partage rien de plus. */
export function parseShare(value: unknown): ContextShare[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(CONTEXT_SHARES);
  const picked = value.filter((item): item is ContextShare => typeof item === "string" && known.has(item));
  return [...new Set(picked)];
}
