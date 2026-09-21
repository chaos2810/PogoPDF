import type { Canvas } from "@napi-rs/canvas";
import { RemoveBlankPagesInputSchema } from "@pogopdf/contracts";
import type { ProgressParams } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled, buildFromPages, invalidInput } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { openRenderer } from "../convertout/shared";

/** Rec.709 luma per channel, matching comparepdfs. */
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The background colour of a rendered page, estimated as the median luma of
 * the border pixels (the outermost row/column on each of the four edges).
 * Border sampling assumes a full-bleed background covers the page edges, which
 * holds for scans and ordinary documents; a page whose content touches every
 * edge can skew the estimate, so this is a heuristic, not a guarantee.
 */
function borderLuma(canvas: Canvas): number {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const samples: number[] = [];
  const at = (x: number, y: number) => {
    const p = (y * width + x) * 4;
    samples.push(luma(data[p], data[p + 1], data[p + 2]));
  };
  for (let x = 0; x < width; x++) {
    at(x, 0);
    at(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    at(0, y);
    at(width - 1, y);
  }
  samples.sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  return samples.length % 2 === 0
    ? (samples[mid - 1] + samples[mid]) / 2
    : samples[mid];
}

/**
 * What fraction of the page's pixels are NOT background (luma more than 30
 * units from the estimated background). A page counts as blank when this is
 * below the tolerance percentage (so tolerance 0 means nothing is blank).
 */
function nonBackgroundRatio(canvas: Canvas, background: number): number {
  const { data } = canvas
    .getContext("2d")
    .getImageData(0, 0, canvas.width, canvas.height);
  let nonBackground = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(luma(data[i], data[i + 1], data[i + 2]) - background) > 30) {
      nonBackground++;
    }
  }
  return nonBackground / (canvas.width * canvas.height);
}

/**
 * Render each page at 72 dpi and drop the blank ones. A page is blank when its
 * non-background pixel ratio is below `tolerance` percent. All pages blank is
 * refused (INVALID_INPUT): removing every page would produce an empty
 * document, which is a job error rather than a "blank file" result.
 */
export async function runRemoveBlankPages(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, tolerance } = RemoveBlankPagesInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const pageCount = src.getPageCount();
  const renderer = await openRenderer(filePath);
  const keep: Array<{ index: number }> = [];
  try {
    for (let i = 0; i < pageCount; i++) {
      assertNotCancelled(ctx);
      const canvas = await renderer.renderPage(i, 72);
      const ratio = nonBackgroundRatio(canvas, borderLuma(canvas)) * 100;
      if (ratio >= tolerance) keep.push({ index: i });

      const done = i + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / pageCount) * 100),
        stage: "scanning",
        pagesDone: done,
      } satisfies ProgressParams);
    }
  } finally {
    await renderer.close();
  }

  if (keep.length === 0) {
    throw invalidInput(
      `Every page is blank at tolerance ${tolerance}%; refusing to produce an empty document`
    );
  }

  const out = await buildFromPages(src, keep);
  return savePdf(out, outDir, "clean.pdf");
}
