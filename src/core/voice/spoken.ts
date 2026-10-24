/**
 * Texte prêt à être lu à voix haute. Une réponse écrite pour l'écran contient des adresses, des puces, des
 * guillemets et une ligne de sources : rien de cela ne doit être lu tel quel. Le texte est coupé en phrases, pour que
 * la voix garde une intonation naturelle et que la lecture ne s'arrête pas sur une longue phrase.
 */

/** Au-delà de cette longueur, une phrase est coupée aux virgules : les moteurs vocaux décrochent sur les longues phrases. */
const MAX_SENTENCE_CHARS = 200;

export function spokenSentences(text: string): string[] {
  const cleaned = text
    .split("\n")
    .filter((line) => !/^\s*sources?\s*:/i.test(line))
    .join(" ")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/\s[·•|›]\s/g, ", ")
    .replace(/[*_`#«»“”"]/g, "")
    .replace(/\s+([.,!?;:…)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = cleaned.match(/[^.!?…]+[.!?…]*/g) ?? [];
  return sentences.flatMap((sentence) => splitLong(sentence.trim())).filter((sentence) => /\p{L}|\p{N}/u.test(sentence));
}

function splitLong(sentence: string): string[] {
  if (sentence.length <= MAX_SENTENCE_CHARS) return [sentence];
  const parts: string[] = [];
  let current = "";
  for (const piece of sentence.split(/(?<=,)\s/)) {
    if (current && current.length + piece.length > MAX_SENTENCE_CHARS) {
      parts.push(current.trim());
      current = "";
    }
    current += `${piece} `;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
