import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { PdfToSvgInputSchema, parsePageSelection } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { encodeCanvas } from "../../render/encode";
import { assertNotCancelled } from "../organize/organize";
import { openRenderer } from "./shared";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * RASTER WRAP, not vector. pdfjs-dist 6.3 ships no SVG rendering backend in
 * Node: its only SVG-related export is `DOMSVGFactory` (used by the
 * annotation/editor layers) and the historical `SVGGraphics` renderer is
 * absent from the bundle entirely. Rather than pretend otherwise, the dpi
 * raster is wrapped in a page-sized SVG — viewBox/width/height are the page's
 * true point dimensions, so it still lays out at the correct page size. The UI
 * surfaces `tool.pdftosvg.rasterHint` so the user knows the output is not
 * vector.
 */
async function pageToSvg(
  renderer: Awaited<ReturnType<typeof openRenderer>>,
  index: number,
  dpi: number
): Promise<string> {
  const page = await renderer.getPage(index);
  const pt = page.getViewport({ scale: 1 });
  const canvas = await renderer.renderPage(index, dpi);
  const png = await encodeCanvas(canvas, "png");

  const w = round2(pt.width);
  const h = round2(pt.height);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
    `width="${w}pt" height="${h}pt">` +
    `<image href="data:image/png;base64,${png.toString("base64")}" ` +
    `width="${w}" height="${h}"/>` +
    `</svg>`
  );
}

export async function runPdfToSvg(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string[]> {
  const { filePath, dpi, pages } = PdfToSvgInputSchema.parse(input);
  assertNotCancelled(ctx);

  const renderer = await openRenderer(filePath);
  try {
    const selected =
      pages === undefined
        ? Array.from({ length: renderer.pageCount }, (_, i) => i)
        : parsePageSelection(pages, renderer.pageCount);
    const stem = basename(filePath, extname(filePath));
    const out: string[] = [];

    for (let n = 0; n < selected.length; n++) {
      assertNotCancelled(ctx);
      const svg = await pageToSvg(renderer, selected[n], dpi);
      const outPath = join(outDir, `${stem}-${n + 1}.svg`);
      await writeFile(outPath, svg);
      out.push(outPath);
      const done = n + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / selected.length) * 100),
        stage: "rendering",
        pagesDone: done,
      });
    }
    return out;
  } finally {
    await renderer.close();
  }
}
