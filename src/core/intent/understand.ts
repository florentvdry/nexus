/**
 * Compréhension des formulations naturelles, sans modèle de langage : politesse, questions, demandes enchaînées,
 * fautes de frappe. Chaque fonction est pure et testée ; aucune ne lance d'action.
 */

/** Formules d'entrée de politesse ou de question, en début de phrase. Appliquées jusqu'à stabilité. */
const OPENERS: RegExp[] = [
  /^est[- ]ce (?:que |qu')/i,
  /^(?:s'?il\s+(?:te|vous)\s+pla[iî]t\s*[,:]?\s+)/i,
  /^(?:tu\s+|vous\s+)?(?:peux|pourrais|pourriez|pouvez|pourras)(?:[- ]tu|[- ]vous)?\s+(?:me\s+|nous\s+)?/i,
  /^(?:je\s+voudrais|j'?\s*aimerais|j'?\s*aimerai|j'?\s*ai\s+besoin\s+de|il\s+faudrait|il\s+faut\s+que\s+tu)\s+(?:que\s+tu\s+)?/i,
  /^(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+)?/i,
  /^please\s+/i,
  /^(?:i\s+want\s+to|i\s+would\s+like\s+to|i'?d\s+like\s+to)\s+/i,
];

/** Formules de politesse en fin de phrase. */
const CLOSERS: RegExp[] = [/[\s,;]+(?:s'?il\s+(?:te|vous)\s+pla[iî]t|stp|svp|merci|please|thanks?|thank\s+you)\s*[.!?]*$/i];

/**
 * Retire les formules de politesse et de question autour de la demande. La demande elle-même, chemins et casse
 * compris, est conservée : « peux-tu ouvrir Discord ? » devient « ouvrir Discord ».
 */
export function stripPoliteness(raw: string): string {
  let text = raw.trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const before = text;
    for (const opener of OPENERS) text = text.replace(opener, "");
    for (const closer of CLOSERS) text = text.replace(closer, "");
    text = text.trim();
    if (text === before) break;
  }
  return text.replace(/[?]+$/, "").trim() || raw.trim();
}

/** Séparateurs entre demandes successives : « ouvre X puis Y », « … et ensuite … », « … then … ». */
const STEP_SEPARATOR = /\s*,?\s+(?:puis|ensuite|et\s+ensuite|et\s+apr[eè]s|then|and\s+then)\s+/i;
export const MAX_STEPS = 3;

/**
 * Découpe une phrase en demandes successives, dans la limite de `MAX_STEPS`. Une phrase sans séparateur reste
 * entière : « et » seul n'est jamais un séparateur, car il relie souvent les mots d'un même nom.
 */
export function splitSteps(raw: string): string[] {
  const parts = raw.split(STEP_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1 || parts.length > MAX_STEPS) return [raw.trim()];
  return parts;
}

/** Distance de Levenshtein : nombre minimal de caractères à changer pour passer d'un mot à l'autre. */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/** Tolérance aux fautes : rien pour un mot court, une faute pour un mot moyen, deux pour un mot long. */
export function typoTolerance(word: string): number {
  if (word.length <= 4) return 0;
  return word.length <= 7 ? 1 : 2;
}

/**
 * Meilleure application proche du nom demandé, s'il n'y en a qu'une seule. Un choix ambigu ne suggère rien.
 * `candidates` : alias normalisés, avec l'identifiant de l'application.
 */
export function closestAlias(name: string, candidates: readonly { id: string; alias: string }[]): { id: string; alias: string } | null {
  const wanted = name.trim();
  if (wanted.length < 4) return null;
  const scored = candidates
    .map((candidate) => ({ candidate, distance: editDistance(wanted, candidate.alias), tolerance: typoTolerance(candidate.alias) }))
    .filter(({ distance, tolerance }) => distance > 0 && distance <= tolerance)
    .sort((a, b) => a.distance - b.distance);
  if (scored.length === 0) return null;
  const best = scored[0];
  // Deux applications aussi proches l'une que l'autre : on ne choisit pas à la place de l'utilisateur.
  if (scored.length > 1 && scored[1].distance === best.distance && scored[1].candidate.id !== best.candidate.id) return null;
  return best.candidate;
}
