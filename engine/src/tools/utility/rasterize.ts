import { PDFDocument } from "pdf-lib";
import { RasterizeInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { encodeCanvas } from "../../render/encode";
import { assertNotCancelled, normalizeAngle } from "../organize/organize";
import { displayedPageSize } from "../edit/pagedraw";
import { loadPdf, savePdf } from "../pdfdoc";
import { openRenderer } from "../convertout/shared";

/**
 * Rebuilds each page as a single full-page image: text and vector content are
 * replaced by their raster at `dpi`, so the output has no extractable text and
 * no annotations (image-only pages by construction). The page keeps the source's
 * displayed dimensions, matching what the user saw before rasterizing.
 */
export async function runRasterize(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, dpi } = RasterizeInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const renderer = await openRenderer(filePath);
  try {
    const out = await PDFDocument.create();
    for (let i = 0; i < renderer.pageCount; i++) {
      assertNotCancelled(ctx);
      const canvas = await renderer.renderPage(i, dpi);
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

      const done = i + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / renderer.pageCount) * 100),
        stage: "rasterizing",
        pagesDone: done,
      });
    }
    return await savePdf(out, outDir, "rasterized.pdf");
  } finally {
    await renderer.close();
  }
}
