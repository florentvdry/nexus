/** Nombre de lignes affichées dans la visionneuse. Au-delà, le reste n'est pas chargé dans l'interface. */
export const MAX_CSV_ROWS = 500;

/**
 * Lit un fichier à colonnes (RFC 4180 : champs entre guillemets, guillemets doublés, retours à la ligne dans les champs).
 * Le séparateur est celui qui apparaît le plus dans la première ligne (virgule, point-virgule ou tabulation).
 * Les lignes plus courtes sont complétées pour garder un tableau rectangulaire.
 */
export function parseDelimited(text: string, delimiter?: string): { rows: string[][]; total: number } {
  const source = text.replace(/^﻿/, "");
  const separator = delimiter ?? detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === separator) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  // Dernière ligne sans retour à la ligne final.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const width = rows.reduce((max, current) => Math.max(max, current.length), 0);
  const padded = rows.map((current) => [...current, ...Array<string>(width - current.length).fill("")]);
  return { rows: padded, total: padded.length };
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}
