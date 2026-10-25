import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * Lecture des PDF avec pdf.js, embarqué dans l'application (aucun CDN). La bibliothèque n'est chargée qu'à la
 * première ouverture d'un PDF. WebAssembly est désactivé : la CSP de NEXUS n'autorise pas `wasm-unsafe-eval`, et
 * pdf.js sait décoder les images sans. Les polices non embarquées sont celles de Windows.
 */
export interface PdfPreview {
  pageCount: number;
  /** Dessine une page (index à partir de 0) dans le canevas, à la largeur demandée en pixels. */
  renderPage(index: number, canvas: HTMLCanvasElement, width: number): Promise<void>;
  destroy(): void;
}

export async function openPdf(data: ArrayBuffer): Promise<PdfPreview> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }

  // pdf.js transfère ses octets au worker, qui les détache : une copie protège le tampon de l'appelant
  // (la même lecture peut servir deux fois, p. ex. au second rendu de React en développement).
  const document = await pdfjs.getDocument({
    data: new Uint8Array(data.slice(0)),
    useWasm: false,
    useSystemFonts: true,
    disableAutoFetch: true,
  }).promise;

  return {
    pageCount: document.numPages,
    async renderPage(index, canvas, width) {
      const page = await document.getPage(index + 1);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / natural.width });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
    },
    destroy() {
      // La tâche de chargement libère le document et le transport avec le worker.
      void document.loadingTask.destroy();
    },
  };
}
