import { PDFDocument } from "pdf-lib";
import type { Canvas } from "@napi-rs/canvas";
import type { Annotation } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { encodeCanvas } from "../../render/encode";
import { assertNotCancelled, invalidInput, normalizeAngle } from "../organize/organize";
import { displayedPageSize } from "../../render/pagegeometry";
import { loadPdf, savePdf } from "../pdfdoc";
import { openRenderer } from "../convertout/shared";
import { writeAnnotations, redactedPages } from "./annotations";

const REDACT_DPI = 150;

/** Opaque black over each redact rect, on the raster's displayed-space canvas. */
function fillRedactions(
  canvas: Canvas,
  rects: Array<{ x: number; y: number; w: number; h: number }>,
  scale: number
): void {
  const ctx2d = canvas.getContext("2d");
  ctx2d.fillStyle = "#000000";
  for (const rect of rects) {
    ctx2d.fillRect(rect.x * scale, rect.y * scale, rect.w * scale, rect.h * scale);
  }
}

/**
 * True redaction: every page carrying a redact rect is re-rendered as a raster
 * at 150 dpi with opaque black fills over the marked areas, then rebuilt as an
 * image-only page at its displayed size. The original content stream is gone,
 * so the marked text is genuinely unrecoverable (not merely covered).
 *
 * v1 tradeoff, documented in the UI: flattening a page drops every other
 * annotation that page carried. Non-redact annotations on pages WITHOUT redact
 * rects are written normally, and such pages keep their text.
 */
export async function applyRedactions(
  filePath: string,
  annotations: Annotation[],
  outDir: string,
  ctx: RpcCtx
): Promise<string> {
  const redactPages = redactedPages(annotations);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const renderer = await openRenderer(filePath);
  try {
    const count = src.getPageCount();
    for (const page of redactPages) {
      if (page > count) {
        throw invalidInput(`Redaction page ${page} is out of range (1-${count})`);
      }
    }

    const out = await PDFDocument.create();
    const keepAnnots: Annotation[] = [];

    for (let i = 0; i < count; i++) {
      assertNotCancelled(ctx);
      const pageNumber = i + 1;
      if (redactPages.has(pageNumber)) {
        const canvas = await renderer.renderPage(i, REDACT_DPI);
        const rects = annotations
          .filter((a) => a.type === "redact" && a.page === pageNumber)
          .map((a) => a.rect!);
        fillRedactions(canvas, rects, REDACT_DPI / 72);
        const png = await encodeCanvas(canvas, "png");
        const image = await out.embedPng(png);

        // The raster already carries the page's /Rotate, so use the displayed box.
        const { width, height } = src.getPage(i).getSize();
        const rotation = normalizeAngle(src.getPage(i).getRotation().angle);
        const displayed = displayedPageSize(rotation, width, height);
        const page = out.addPage([displayed.width, displayed.height]);
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: page.getWidth(),
          height: page.getHeight(),
        });
      } else {
        const [copied] = await out.copyPages(src, [i]);
        out.addPage(copied);
        for (const annot of annotations) {
          if (annot.page === pageNumber && annot.type !== "redact") keepAnnots.push(annot);
        }
      }

      const done = i + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / count) * 100),
        stage: "redacting",
        pagesDone: done,
      });
    }

    await writeAnnotations(out, keepAnnots, ctx);
    return await savePdf(out, outDir, "edited.pdf");
  } finally {
    await renderer.close();
  }
}
