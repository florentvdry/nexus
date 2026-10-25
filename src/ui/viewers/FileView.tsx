import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { NativeCallError, NativeUnavailableError } from "../../core/native/adapter";
import { MAX_CSV_ROWS, parseDelimited } from "../../core/viewers/csv";
import { extensionOf, MAX_VIEW_BYTES, mimeTypeOf, viewerKindOf, type ViewerKind } from "../../core/viewers/formats";
import { parseInline, parseMarkdown, type InlineSegment, type MarkdownBlock } from "../../core/viewers/markdown";
import { hasMessage } from "../../i18n/messages";
import type { MessageKey } from "../../i18n/messages";
import { openPdf, type PdfPreview } from "./pdf";

/** Nombre de pages de PDF dessinées : au-delà, la fenêtre resterait lente. */
const MAX_PDF_PAGES = 30;
/** Caractères affichés pour un texte. Le reste n'est pas chargé dans le DOM. */
const MAX_TEXT_CHARS = 200_000;

export type ReadFile = (path: string) => Promise<ArrayBuffer>;
type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Visionneuse d'un fichier désigné par son chemin. Le contenu vient du natif (dossiers autorisés, taille bornée) ;
 * l'interface ne fait que le décoder et l'afficher. Rien n'est enregistré, rien n'est envoyé.
 */
export function FileView({ path, readFile, t }: { path: string; readFile?: ReadFile; t: Translate }) {
  const kind = viewerKindOf(path);
  const [loaded, setLoaded] = useState<{ status: "loading" } | { status: "error"; reason: string } | { status: "ready"; bytes: ArrayBuffer }>({
    status: "loading",
  });

  useEffect(() => {
    // Un format inconnu n'est jamais lu : le natif ne voit pas de demande inutile.
    if (kind === null) return;
    let active = true;
    setLoaded({ status: "loading" });
    if (!readFile) {
      setLoaded({ status: "error", reason: t("view.noReader") });
      return;
    }
    readFile(path).then(
      (bytes) => {
        if (active) setLoaded({ status: "ready", bytes });
      },
      (error: unknown) => {
        if (active) setLoaded({ status: "error", reason: describeReadError(error, t) });
      },
    );
    return () => {
      active = false;
    };
    // Seuls le chemin et le lecteur déclenchent une lecture : `t` change à chaque rendu du parent.
  }, [path, readFile, kind]);

  let body: ReactNode;
  if (kind === null) {
    body = <p className="error-card viewer-status" role="alert">{t("view.unsupported", { extension: extensionOf(path) || "?" })}</p>;
  } else if (loaded.status === "loading") {
    body = <p className="viewer-status">{t("view.loading")}</p>;
  } else if (loaded.status === "error") {
    body = <p className="error-card viewer-status" role="alert">{t("view.error", { reason: loaded.reason })}</p>;
  } else {
    body = <Content kind={kind} path={path} bytes={loaded.bytes} t={t} />;
  }

  return (
    <div className="viewer">
      <div className="viewer-content">{body}</div>
      <p className="viewer-meta" title={path}>
        {path}
      </p>
    </div>
  );
}

function Content({ kind, path, bytes, t }: { kind: ViewerKind; path: string; bytes: ArrayBuffer; t: Translate }) {
  if (bytes.byteLength > MAX_VIEW_BYTES) {
    return <p className="error-card viewer-status" role="alert">{t("view.error", { reason: `${MAX_VIEW_BYTES / 1024 / 1024} Mo max` })}</p>;
  }
  switch (kind) {
    case "image":
    case "audio":
    case "video":
      return <BlobMedia kind={kind} path={path} bytes={bytes} t={t} />;
    case "pdf":
      return <PdfPages bytes={bytes} t={t} />;
    case "csv":
      return <CsvTable text={decode(bytes)} t={t} />;
    case "markdown":
      return <Markdown text={decode(bytes)} />;
    case "text":
      return <PlainText bytes={bytes} t={t} />;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Le motif d'un refus natif, dans les mots de l'application (`error.code.*`) quand ils existent. */
function describeReadError(error: unknown, t: Translate): string {
  if (error instanceof NativeUnavailableError) return t("view.noReader");
  if (error instanceof NativeCallError) {
    const key = `error.code.${error.code}`;
    if (hasMessage(key)) return t(key, { details: error.message });
  }
  return errorMessage(error);
}

/** UTF-8 d'abord ; à défaut, Windows-1252, encodage habituel des vieux fichiers Windows. */
function decode(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function isBinary(bytes: ArrayBuffer): boolean {
  return new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8192)).includes(0);
}

function PlainText({ bytes, t }: { bytes: ArrayBuffer; t: Translate }) {
  if (isBinary(bytes)) return <p className="error-card viewer-status" role="alert">{t("view.binary")}</p>;
  const text = decode(bytes);
  const shown = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  return (
    <>
      <pre className="viewer-text">{shown}</pre>
      {shown.length < text.length && <p className="field-hint">{t("view.text.truncated", { shown: MAX_TEXT_CHARS })}</p>}
    </>
  );
}

/** Image, audio ou vidéo : un blob du bon type MIME, libéré dès que la fenêtre change de fichier. */
function BlobMedia({ kind, path, bytes, t }: { kind: "image" | "audio" | "video"; path: string; bytes: ArrayBuffer; t: Translate }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const next = URL.createObjectURL(new Blob([bytes], { type: mimeTypeOf(path) }));
    setUrl(next);
    setFailed(false);
    return () => URL.revokeObjectURL(next);
  }, [bytes, path]);

  if (failed) return <p className="error-card viewer-status" role="alert">{t("view.mediaError")}</p>;
  if (!url) return null;

  const fail = () => setFailed(true);
  const name = path.split(/[\\/]/).pop() ?? path;
  if (kind === "image") return <img className="viewer-image" src={url} alt={name} onError={fail} />;
  if (kind === "audio") return <audio className="viewer-media" controls src={url} onError={fail} />;
  return <video className="viewer-media" controls src={url} onError={fail} />;
}

/** Les premières pages d'un PDF, dessinées en canevas : rien n'est inséré dans le DOM comme HTML. */
function PdfPages({ bytes, t }: { bytes: ArrayBuffer; t: Translate }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<{ status: "loading" } | { status: "error"; reason: string } | { status: "ready"; total: number; shown: number }>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    let preview: PdfPreview | null = null;
    const container = pagesRef.current;

    (async () => {
      try {
        const opened = await openPdf(bytes);
        // La fenêtre a changé ou disparu pendant l'ouverture : le document est libéré tout de suite.
        if (!active) {
          opened.destroy();
          return;
        }
        preview = opened;
        if (!container) return;
        const shown = Math.min(preview.pageCount, MAX_PDF_PAGES);
        setInfo({ status: "ready", total: preview.pageCount, shown });
        const width = Math.max(200, container.clientWidth - 4);
        for (let index = 0; index < shown && active; index += 1) {
          const canvas = document.createElement("canvas");
          canvas.className = "viewer-page";
          canvas.setAttribute("aria-label", `${index + 1}`);
          container.appendChild(canvas);
          await preview.renderPage(index, canvas, width);
        }
      } catch (error) {
        if (active) setInfo({ status: "error", reason: errorMessage(error) });
      }
    })();

    return () => {
      active = false;
      container?.replaceChildren();
      preview?.destroy();
    };
  }, [bytes]);

  return (
    <>
      {info.status === "loading" && <p className="viewer-status">{t("view.loading")}</p>}
      {info.status === "error" && (
        <p className="error-card viewer-status" role="alert">
          {t("view.pdfError")}
          <span className="viewer-reason">{info.reason}</span>
        </p>
      )}
      {info.status === "ready" && <p className="field-hint">{t("view.pdf.count", { total: info.total })}</p>}
      {info.status === "ready" && info.shown < info.total && (
        <p className="field-hint">{t("view.pdf.truncated", { shown: info.shown })}</p>
      )}
      <div className="viewer-pdf" ref={pagesRef} />
    </>
  );
}

function CsvTable({ text, t }: { text: string; t: Translate }) {
  const { rows, total } = useMemo(() => parseDelimited(text), [text]);
  const [header = [], ...body] = rows;
  const shown = body.slice(0, MAX_CSV_ROWS);
  return (
    <>
      <div className="viewer-table">
        <table className="data-table">
          <thead>
            <tr>
              {header.map((cell, index) => (
                <th key={index} scope="col">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {body.length > shown.length && <p className="field-hint">{t("view.csv.truncated", { shown: shown.length, total: total - 1 })}</p>}
    </>
  );
}

function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="viewer-markdown">{blocks.map((block, index) => <Block key={index} block={block} />)}</div>;
}

const HEADINGS = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.kind) {
    case "heading": {
      const Tag = HEADINGS[Math.min(6, Math.max(1, block.level)) as keyof typeof HEADINGS];
      return <Tag><Inline text={block.text} /></Tag>;
    }
    case "paragraph":
      return <p><Inline text={block.text} /></p>;
    case "code":
      return <pre className="viewer-code" data-language={block.language || undefined}><code>{block.text}</code></pre>;
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index}><Inline text={item} /></li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "quote":
      return <blockquote><Inline text={block.text} /></blockquote>;
    case "rule":
      return <hr />;
  }
}

function Inline({ text }: { text: string }) {
  return <>{parseInline(text).map((segment, index) => renderSegment(segment, index))}</>;
}

function renderSegment(segment: InlineSegment, key: number): ReactNode {
  switch (segment.kind) {
    case "text":
      return <span key={key}>{segment.text}</span>;
    case "code":
      return <code key={key}>{segment.text}</code>;
    case "strong":
      return <strong key={key}>{segment.text}</strong>;
    case "em":
      return <em key={key}>{segment.text}</em>;
    case "link":
      // Pas de navigation depuis la fenêtre : le lien s'affiche, son adresse apparaît au survol.
      return (
        <span key={key} className="viewer-link" title={segment.href}>
          {segment.text}
        </span>
      );
  }
}
