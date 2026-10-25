/**
 * Formats que NEXUS sait afficher dans une fenêtre. Le choix se fait sur l'extension seule : le contenu n'est lu
 * qu'ensuite, par le natif, dans les dossiers autorisés.
 */
export type ViewerKind = "pdf" | "image" | "text" | "markdown" | "csv" | "audio" | "video";

/**
 * Taille maximale lue pour un affichage. Doit rester identique à `MAX_VIEW_BYTES` côté natif
 * (`src-tauri/src/plugins/actions/files.rs`).
 */
export const MAX_VIEW_BYTES = 100 * 1024 * 1024;

const TEXT_EXTENSIONS = [
  // Texte et données structurées : affichés tels quels, jamais interprétés.
  "txt", "log", "ini", "cfg", "conf", "json", "xml", "yaml", "yml", "toml", "html", "htm",
  // Code source courant.
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "rs", "java", "c", "h", "cpp", "hpp", "cs", "go", "rb", "php",
  "css", "sh", "ps1", "bat", "sql",
];

const KINDS: Record<string, ViewerKind> = {
  pdf: "pdf",
  // SVG volontairement absent : un fichier SVG peut contenir du script.
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  md: "markdown",
  markdown: "markdown",
  csv: "csv",
  tsv: "csv",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  m4a: "audio",
  mp4: "video",
  webm: "video",
  ...Object.fromEntries(TEXT_EXTENSIONS.map((extension) => [extension, "text" as const])),
};

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
};

/** Extension en minuscules, sans le point. Accepte un chemin Windows ou POSIX. */
export function extensionOf(pathOrName: string): string {
  const name = pathOrName.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Nom du fichier seul, sans son dossier. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Type d'affichage du fichier, ou `null` si NEXUS ne sait pas l'afficher. */
export function viewerKindOf(pathOrName: string): ViewerKind | null {
  return KINDS[extensionOf(pathOrName)] ?? null;
}

/** Type MIME à donner au blob : les lecteurs audio et vidéo s'y fient. Vide pour les formats de texte. */
export function mimeTypeOf(pathOrName: string): string {
  return MIME_TYPES[extensionOf(pathOrName)] ?? "application/octet-stream";
}

/** Chemin absolu Windows (`C:\…`, `\\serveur\…`) ou POSIX (`/…`). */
export function isAbsolutePath(path: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(path.trim());
}
