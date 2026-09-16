import { convertFileSrc } from "@tauri-apps/api/core";

export type PdfThumb = {
  index: number;
  dataUrl: string;
  width: number;
  height: number;
};

type MockThumbsHook = (count?: number) => PdfThumb[] | Promise<PdfThumb[]> | null;

// Dev-only seam: mock-tauri.ts installs __mockPdfThumbs, so the organize screen
// renders fake canvases without pdf.js or real files in screenshot runs.
function mockThumbs(count: number | undefined): PdfThumb[] | undefined {
  if (typeof window === "undefined") return undefined;
  const hook = (window as unknown as { __mockPdfThumbs?: MockThumbsHook }).__mockPdfThumbs;
  const result = hook?.(count);
  return Array.isArray(result) ? result : undefined;
}

const THUMB_WIDTH = 160;

// pdf.js 4.x ships an ES-module worker; Vite's ?url import emits it as an asset
// and pdf.js spawns `new Worker(url, { type: "module" })` itself.
export async function renderPdfThumbs(
  path: string,
  maxPages?: number
): Promise<PdfThumb[]> {
  const mocked = mockThumbs(maxPages);
  if (mocked) return mocked;

  const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = worker.default;

  const doc = await getDocument({ url: convertFileSrc(path) }).promise;
  const count = Math.min(doc.numPages, maxPages ?? doc.numPages);
  const thumbs: PdfThumb[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      thumbs.push({
        index: i,
        dataUrl: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height,
      });
    }
  } finally {
    await doc.destroy();
  }
  return thumbs;
}
