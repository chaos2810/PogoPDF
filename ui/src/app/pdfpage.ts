import { convertFileSrc } from "@tauri-apps/api/core";
import { normalizeRotate } from "./pdfthumbs";

/** A rasterized page plus the displayed-frame size that maps pt to px. */
export type RenderedPage = {
  dataUrl: string;
  widthPt: number;
  heightPt: number;
  rotate: number;
};

export type PageSize = {
  widthPt: number;
  heightPt: number;
  rotate: number;
};

export type PdfDocHandle = {
  pageCount: number;
  /** Displayed-frame page size in PDF points (intrinsic /Rotate applied). */
  pageSize: (pageIndex: number) => Promise<PageSize>;
  render: (pageIndex: number, zoom: number) => Promise<RenderedPage>;
  close: () => Promise<void>;
};

/**
 * Open a PDF for the editor. The page renders WITH the intrinsic /Rotate, so
 * the displayed frame is exactly what the viewer shows and annotation geometry
 * in points maps 1:1 onto it (zoom is px per point).
 *
 * This mirrors the worker wiring in pdfthumbs.ts (pdf.js ships an ES-module
 * worker; Vite emits it as an asset via ?url).
 */
export async function openPdfDoc(path: string): Promise<PdfDocHandle> {
  const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = worker.default;

  // Blob/data URLs come from in-page File objects (dev harness); Tauri's
  // convertFileSrc would mangle them. Everything else is a filesystem path.
  const url = /^(blob:|data:)/i.test(path) ? path : convertFileSrc(path);
  const doc = await getDocument({ url }).promise;

  return {
    pageCount: doc.numPages,

    async pageSize(pageIndex) {
      const page = await doc.getPage(pageIndex + 1);
      const vp = page.getViewport({ scale: 1 });
      return {
        widthPt: vp.width,
        heightPt: vp.height,
        rotate: normalizeRotate(page.rotate),
      };
    },

    async render(pageIndex, zoom) {
      const page = await doc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: zoom });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      return {
        dataUrl: canvas.toDataURL("image/png"),
        widthPt: viewport.width / zoom,
        heightPt: viewport.height / zoom,
        rotate: normalizeRotate(page.rotate),
      };
    },

    async close() {
      await doc.destroy();
    },
  };
}
