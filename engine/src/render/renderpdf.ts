import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import {
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfRenderer = {
  /** Total pages in the document. */
  pageCount: number;
  /** Page proxy for text extraction (pdf.js pages are 1-based). */
  getPage(index: number): Promise<PDFPageProxy>;
  /**
   * Rasterize a single page at `dpi` and return its canvas.
   *
   * Callers MUST render one page at a time and release each canvas before
   * requesting the next — the engine never holds more than one page bitmap.
   */
  renderPage(index: number, dpi: number): Promise<Canvas>;
  close(): Promise<void>;
};

/**
 * pdf.js 6 in Node resolves standard fonts through a filesystem prefix, not a
 * URL: `NodeBinaryDataFactory.fetch` passes `${baseUrl}${filename}` straight to
 * `fs.readFile`. The path must keep its trailing slash and use forward slashes
 * (pdf.js rejects backslashes and `file://` URLs here). Exported for the
 * standard-font resolution test.
 */
export function resolveStandardFontDataUrl(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("pdfjs-dist/package.json");
    return join(dirname(pkg), "standard_fonts").replace(/\\/g, "/") + "/";
  } catch (e) {
    process.stderr.write(
      `PogoPDF: standard fonts unavailable, falling back to substitute glyphs: ${String(e)}\n`
    );
    return undefined;
  }
}

export async function getPdfRenderer(path: string): Promise<PdfRenderer> {
  // `getDataProp` rejects Node Buffers and pdf.js detaches the buffer it is
  // given, so hand over a fresh Uint8Array copy of the file bytes.
  const data = new Uint8Array(readFileSync(path));
  const loadingTask = getDocument({
    data,
    verbosity: 0,
    useWorkerFetch: false,
    standardFontDataUrl: resolveStandardFontDataUrl(),
  });
  const doc: PDFDocumentProxy = await loadingTask.promise;

  return {
    pageCount: doc.numPages,

    async getPage(index: number): Promise<PDFPageProxy> {
      return doc.getPage(index + 1);
    },

    async renderPage(index: number, dpi: number): Promise<Canvas> {
      const page = await doc.getPage(index + 1);
      try {
        const viewport = page.getViewport({ scale: dpi / 72 });
        const canvas = createCanvas(viewport.width, viewport.height);
        // pdf.js 6 wants a DOM-shaped canvas object; @napi-rs/canvas is
        // API-compatible with the 2D context pdf.js drives it through.
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport,
        }).promise;
        return canvas;
      } finally {
        // Release the page's parsed resources after each render so the engine
        // never accumulates per-page state across a long document.
        await page.cleanup();
      }
    },

    async close(): Promise<void> {
      await loadingTask.destroy();
    },
  };
}
