import { convertFileSrc } from "@tauri-apps/api/core";

export type PdfThumb = {
  index: number;
  dataUrl: string;
  width: number;
  height: number;
  // Intrinsic /Rotate, normalized to 0/90/180/270. The grid seeds a page's
  // absolute output rotation from this so pre-rotated scans keep orientation.
  rotate: number;
};

type MockThumbsHook = (
  path?: string,
  maxPages?: number
) => PdfThumb[] | null | Promise<PdfThumb[]>;

// Dev-only seam: mock-tauri.ts installs __mockPdfThumbs, so the organize screen
// renders fake canvases without pdf.js or real files in screenshot runs. The
// hook gets the source path and returns null for blob:/data: URLs so the real
// pdf.js pipeline still runs for the "real PDF" screenshot state.
function mockThumbs(path: string, maxPages?: number): PdfThumb[] | undefined {
  if (typeof window === "undefined") return undefined;
  const hook = (window as unknown as { __mockPdfThumbs?: MockThumbsHook }).__mockPdfThumbs;
  const result = hook?.(path, maxPages);
  return Array.isArray(result) ? result : undefined;
}

// PDF /Rotate is a multiple of 90; normalize negatives and any stray value.
export function normalizeRotate(deg: number): 0 | 90 | 180 | 270 {
  const n = ((deg % 360) + 360) % 360;
  return (((Math.round(n / 90) * 90) % 360) as 0 | 90 | 180 | 270);
}

const THUMB_WIDTH = 160;

// pdf.js 4.x ships an ES-module worker; Vite's ?url import emits it as an asset
// and pdf.js spawns `new Worker(url, { type: "module" })` itself.
export async function renderPdfThumbs(
  path: string,
  maxPages?: number
): Promise<PdfThumb[]> {
  const mocked = mockThumbs(path, maxPages);
  if (mocked) return mocked;

  const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = worker.default;

  // Blob/data URLs come from in-page File objects (dev harness); Tauri's
  // convertFileSrc would mangle them. Everything else is a filesystem path.
  const url = /^(blob:|data:)/i.test(path) ? path : convertFileSrc(path);
  const doc = await getDocument({ url }).promise;
  const count = Math.min(doc.numPages, maxPages ?? doc.numPages);
  const thumbs: PdfThumb[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const page = await doc.getPage(i + 1);
      // Render WITHOUT the intrinsic /Rotate: the grid's CSS transform
      // (rotate(theta), theta = the absolute engine value) is the single source
      // of rotation, so the preview matches the produced PDF instead of
      // double-rotating pre-rotated pages. The intrinsic angle is still reported.
      const base = page.getViewport({ scale: 1, rotation: 0 });
      const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width, rotation: 0 });
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
        rotate: normalizeRotate(page.rotate),
      });
    }
  } finally {
    await doc.destroy();
  }
  return thumbs;
}
