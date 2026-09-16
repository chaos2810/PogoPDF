import { PDFDocument } from "pdf-lib";
import type { Canvas } from "@napi-rs/canvas";
import { PdfToGreyscaleInputSchema, parsePageSelection } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { encodeCanvas } from "../../render/encode";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { openRenderer } from "./shared";

/** Rasterizing at a fixed 150 dpi balances legibility against output size. */
const GREYSCALE_DPI = 150;

/** Rec.709 luma, in place, alpha preserved. */
function desaturate(canvas: Canvas): void {
  const ctx = canvas.getContext("2d");
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const luma = Math.round(
      0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    );
    data[i] = data[i + 1] = data[i + 2] = luma;
  }
  ctx.putImageData(image, 0, 0);
}

export async function runPdfToGreyscale(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, pages } = PdfToGreyscaleInputSchema.parse(input);
  assertNotCancelled(ctx);

  // pdf-lib supplies each source page's MediaBox and /Rotate for the output
  // geometry; pdf.js supplies the raster (already rendered in display
  // orientation).
  const src = await loadPdf(filePath);
  const renderer = await openRenderer(filePath);
  try {
    const selected =
      pages === undefined
        ? Array.from({ length: renderer.pageCount }, (_, i) => i)
        : parsePageSelection(pages, renderer.pageCount);

    const out = await PDFDocument.create();
    for (let n = 0; n < selected.length; n++) {
      assertNotCancelled(ctx);
      const index = selected[n];
      const canvas = await renderer.renderPage(index, GREYSCALE_DPI);
      desaturate(canvas);
      const png = await encodeCanvas(canvas, "png");
      const image = await out.embedPng(png);

      // The raster has the page's rotation baked in, so the output page must
      // use the rendered (display) dimensions: 90/270 swap the MediaBox.
      const { width, height } = src.getPage(index).getSize();
      const rotation = src.getPage(index).getRotation().angle;
      const swaps = rotation === 90 || rotation === 270;
      const page = out.addPage(swaps ? [height, width] : [width, height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: page.getWidth(),
        height: page.getHeight(),
      });

      const done = n + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / selected.length) * 100),
        stage: "greyscaling",
        pagesDone: done,
      });
    }
    return await savePdf(out, outDir, "greyscale.pdf");
  } finally {
    await renderer.close();
  }
}
