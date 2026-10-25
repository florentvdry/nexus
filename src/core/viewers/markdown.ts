/**
 * Markdown lu pour l'affichage : titres, paragraphes, listes, citations, blocs de code, règles, et emphase en ligne.
 * Ce n'est pas un rendu complet : les images et les liens s'affichent sous forme de texte, sans navigation.
 * Le résultat est une structure de données, jamais du HTML : l'interface la rend avec des éléments React.
 */

export type InlineSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "link"; text: string; href: string };

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; language: string; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

/** Découpe un texte Markdown en blocs. Un bloc de code non fermé va jusqu'à la fin du texte. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith(marker)) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // la ligne de fermeture, si elle existe
      blocks.push({ kind: "code", language: fence[2], text: code.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const unordered = UNORDERED.exec(line);
    const ordered = ORDERED.exec(line);
    if (unordered || ordered) {
      const isOrdered = !unordered;
      const pattern = isOrdered ? ORDERED : UNORDERED;
      const items: string[] = [];
      while (index < lines.length) {
        const match = pattern.exec(lines[index]);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      const parts: string[] = [];
      while (index < lines.length) {
        const match = QUOTE.exec(lines[index]);
        if (!match) break;
        parts.push(match[1]);
        index += 1;
      }
      blocks.push({ kind: "quote", text: parts.join("\n") });
      continue;
    }

    // Paragraphe : les lignes suivantes se rattachent tant qu'un autre bloc ne commence pas.
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() !== "" && !startsBlock(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n").trim() });
  }

  return blocks;
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || UNORDERED.test(line) || ORDERED.test(line) || QUOTE.test(line);
}

// Les soulignés ne ferment l'emphase qu'en dehors des mots : `nom_de_fichier` reste tel quel.
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|(?<!\w)__([^_]+)__(?!\w)|\*([^*\s][^*]*)\*|(?<!\w)_([^_\s][^_]*)_(?!\w)|!?\[([^\]]*)\]\(([^)\s]*)\)/g;

/** Emphase, code en ligne et liens, en segments. Les images (`![alt](src)`) deviennent leur texte alternatif. */
export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    if (match[1] !== undefined) segments.push({ kind: "code", text: match[1] });
    else if (match[2] !== undefined || match[3] !== undefined) segments.push({ kind: "strong", text: match[2] ?? match[3] });
    else if (match[4] !== undefined || match[5] !== undefined) segments.push({ kind: "em", text: match[4] ?? match[5] });
    else if (match[6] !== undefined) {
      const label = match[6];
      const href = match[7] ?? "";
      const isImage = text[start] === "!";
      if (isImage) segments.push({ kind: "text", text: label });
      else segments.push({ kind: "link", text: label, href });
    }
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}
