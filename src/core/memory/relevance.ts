/**
 * Choix des souvenirs envoyés au modèle avec une demande. Au lieu de tout injecter (la mémoire n'a pas de limite de
 * nombre), on garde les souvenirs qui partagent des mots avec la demande, puis on complète avec les plus récents.
 * Le total reste borné : le modèle local reçoit un contexte de taille stable, même après des mois d'utilisation.
 *
 * Fonction pure : elle ne lit ni le disque ni le modèle. Les souvenirs arrivent du plus ancien au plus récent.
 */

/** Mots vides français et anglais : ils ne désignent rien et feraient correspondre presque tous les souvenirs. */
const STOPWORDS = new Set(
  (
    "le la les un une des de du d l et ou a au aux en dans pour par sur avec sans que qui quoi est suis es sont " +
    "je tu il elle nous vous ils elles me te se mon ma mes ton ta tes son sa ses notre votre leur leurs ce cet cette ces " +
    "ne pas plus tres si y ai as ont fait faire peux peut veux veut moi toi lui eux " +
    "the a an of and or to in on for with is are be i you it my me we our your this that"
  ).split(" "),
);

/** Nombre maximal de souvenirs envoyés au modèle avec une demande. */
export const MEMORY_CONTEXT_LIMIT = 12;

/** Part du contexte réservée aux souvenirs pertinents ; le reste revient aux plus récents. */
const RELEVANT_SHARE = 0.6;

/** Mots normalisés (minuscules, sans accents) qui ont du sens, dédoublonnés. */
export function meaningfulTokens(text: string): string[] {
  const normalized = text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
  const words = normalized.split(/[^a-z0-9]+/).filter((word) => word.length >= 2 && !STOPWORDS.has(word));
  return [...new Set(words)];
}

/** Deux mots se correspondent s'ils sont égaux, ou si l'un est le début d'un mot de plus de cinq lettres (pluriels, conjugaisons). */
function matches(query: string, word: string): boolean {
  if (query === word) return true;
  const [shorter, longer] = query.length <= word.length ? [query, word] : [word, query];
  return shorter.length >= 5 && longer.startsWith(shorter);
}

export function selectRelevantMemories(memories: readonly string[], query: string, limit: number): string[] {
  if (limit <= 0) return [];
  if (memories.length <= limit) return [...memories];

  const tokens = meaningfulTokens(query);
  const documents = memories.map((memory) => meaningfulTokens(memory));
  const scores = memories.map(() => 0);

  for (const token of tokens) {
    const hits = documents.map((words) => words.some((word) => matches(token, word)));
    const documentFrequency = hits.filter(Boolean).length;
    if (documentFrequency === 0) continue;
    // Un mot rare dans les souvenirs pèse plus qu'un mot présent partout.
    const weight = Math.log((memories.length + 1) / (documentFrequency + 0.5));
    hits.forEach((hit, index) => {
      if (hit) scores[index] += weight;
    });
  }

  const relevantSlots = Math.max(1, Math.floor(limit * RELEVANT_SHARE));
  const relevant = memories
    .map((_, index) => index)
    .filter((index) => scores[index] > 0)
    .sort((a, b) => scores[b] - scores[a] || b - a)
    .slice(0, relevantSlots);

  const chosen = new Set(relevant);
  for (let index = memories.length - 1; index >= 0 && chosen.size < limit; index -= 1) {
    chosen.add(index);
  }

  return [...chosen].sort((a, b) => a - b).map((index) => memories[index]);
}
