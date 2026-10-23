const WAKE_WORDS = new Set(["jarvis", "nexus"]);

/**
 * Forme canonique d'une commande : minuscules, sans accents ni ponctuation parasite.
 * Les points internes sont conservés pour les domaines (example.com).
 */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['’`-]/g, " ")
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean)
    .join(" ");
}

/** Retire un mot d'activation placé en tête de phrase (« Jarvis, lance Discord »). */
export function stripWakeWord(normalized: string): string {
  const [first, ...rest] = normalized.split(" ");
  return WAKE_WORDS.has(first) && rest.length > 0 ? rest.join(" ") : normalized;
}
