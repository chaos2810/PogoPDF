import { existsSync, readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import type { Document, Pixmap } from "mupdf";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadMupdf } from "../../render/mupdfengine";
import { corrupt } from "../errors";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled, normalizeAngle } from "../organize/organize";
import { displayedPageSize } from "../../render/pagegeometry";

/** The raster resolution used for every image-ops rebuild. */
export const IMAGE_DPI = 150;

type MupdfModule = Awaited<ReturnType<typeof loadMupdf>>;

/**
 * Open a PDF through mupdf with the engine's typed errors: a missing file or
 * unreadable bytes become CORRUPT_PDF, a password-protected file becomes
 * ENCRYPTED_PDF. mupdf's Pixmap API is what the color and effect tools mutate.
 */
export async function openMupdfPdf(
  filePath: string
): Promise<{ mupdf: MupdfModule; doc: Document }> {
  if (!existsSync(filePath)) throw corrupt(`File not found: ${filePath}`);
  const mupdf = await loadMupdf();
  let doc: Document;
  try {
    doc = mupdf.Document.openDocument(readFileSync(filePath), "application/pdf");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw corrupt(`Cannot open ${filePath}: ${msg}`);
  }
  if (doc.needsPassword()) {
    doc.destroy();
    throw Object.assign(new Error(`Encrypted documents are not supported: ${filePath}`), {
      code: TOOL_ERROR_CODES.ENCRYPTED_PDF,
    });
  }
  return { mupdf, doc };
}

/** Sample count sharp's raw pipeline accepts. */
export type RawChannels = 1 | 2 | 3 | 4;

/** Number of samples per pixel in a pixmap (1 gray, 3 RGB, 4 RGBA). */
export function pixmapChannels(pix: Pixmap): RawChannels {
  return (pix.getPixels().length / (pix.getWidth() * pix.getHeight())) as RawChannels;
}

/** The raw bytes of a pixmap as a Node Buffer sharing the wasm heap memory. */
export function pixmapRaw(pix: Pixmap): Buffer {
  return Buffer.from(pix.getPixels());
}

/**
 * The raster-rebuild spine shared by every image-ops tool: render each page at
 * `dpi`, hand the pixmap to `transform` for its PNG bytes, then re-embed the
 * image full-page at the source page's displayed dimensions (so /Rotate is
 * baked in exactly as it is for rasterize and pdfToGreyscale).
 */
export async function rebuildRasterPdf(
  filePath: string,
  ctx: RpcCtx,
  outDir: string,
  outName: string,
  stage: string,
  opts: { alpha?: boolean; dpi?: number },
  transform: (pix: Pixmap, index: number) => Promise<Buffer>
): Promise<string> {
  const src = await loadPdf(filePath);
  const { mupdf, doc } = await openMupdfPdf(filePath);
  try {
    const out = await PDFDocument.create();
    const count = src.getPageCount();
    const dpi = opts.dpi ?? IMAGE_DPI;
    for (let i = 0; i < count; i++) {
      assertNotCancelled(ctx);
      const page = doc.loadPage(i);
      let png: Buffer;
      try {
        const scale = dpi / 72;
        const pix = page.toPixmap(
          mupdf.Matrix.scale(scale, scale),
          mupdf.ColorSpace.DeviceRGB,
          opts.alpha ?? false
        );
        try {
          png = await transform(pix, i);
        } finally {
          pix.destroy();
        }
      } finally {
        page.destroy();
      }

      const image = await out.embedPng(png);
      const { width, height } = src.getPage(i).getSize();
      const rotation = normalizeAngle(src.getPage(i).getRotation().angle);
      const displayed = displayedPageSize(rotation, width, height);
      const outPage = out.addPage([displayed.width, displayed.height]);
      outPage.drawImage(image, {
        x: 0,
        y: 0,
        width: outPage.getWidth(),
        height: outPage.getHeight(),
      });

      const done = i + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / count) * 100),
        stage,
        pagesDone: done,
      });
    }
    return await savePdf(out, outDir, outName);
  } finally {
    doc.destroy();
  }
}
