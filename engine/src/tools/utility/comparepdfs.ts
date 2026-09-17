import type { Canvas } from "@napi-rs/canvas";
import { ComparePdfsInputSchema } from "@pogopdf/contracts";
import type { ComparePdfsData } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import type { PdfRenderer } from "../../render/renderpdf";
import { assertNotCancelled } from "../organize/organize";
import { openRenderer } from "../convertout/shared";

export type { ComparePdfsData };

/** Both pages are downscaled to this many cells per side for comparison. */
const GRID = 32;
/** Two cells count as different when their average luma differs by this much. */
const CELL_LUMA_DIFF = 25;
/** A page differs when more than this fraction of its 1024 cells differ. */
const DIFF_CELL_RATIO = 0.02;
/** Rendered dimensions may differ by up to this many px before it is flagged. */
const SIZE_TOLERANCE_PX = 2;
const DPI = 72;

/**
 * Average Rec.709 luma per cell of a GRID x GRID overlay. Sampling in relative
 * coordinates makes the grid independent of the page's pixel dimensions, so two
 * differently sized pages can still be compared cell for cell.
 */
function lumaGrid(canvas: Canvas): Float64Array {
  const { data } = canvas
    .getContext("2d")
    .getImageData(0, 0, canvas.width, canvas.height);
  const sums = new Float64Array(GRID * GRID);
  const counts = new Int32Array(GRID * GRID);

  for (let y = 0; y < canvas.height; y++) {
    const gy = Math.min(GRID - 1, Math.floor((y * GRID) / canvas.height));
    const row = y * canvas.width;
    for (let x = 0; x < canvas.width; x++) {
      const gx = Math.min(GRID - 1, Math.floor((x * GRID) / canvas.width));
      const p = (row + x) * 4;
      const luma = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
      const cell = gy * GRID + gx;
      sums[cell] += luma;
      counts[cell] += 1;
    }
  }
  for (let i = 0; i < sums.length; i++) {
    sums[i] /= counts[i] || 1;
  }
  return sums;
}

function differs(a: Float64Array, b: Float64Array): boolean {
  const threshold = GRID * GRID * DIFF_CELL_RATIO;
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > CELL_LUMA_DIFF) differing++;
  }
  return differing > threshold;
}

export async function runComparePdfs(
  input: unknown,
  ctx: RpcCtx,
  _outDir: string
): Promise<ComparePdfsData> {
  const { filePaths } = ComparePdfsInputSchema.parse(input);
  assertNotCancelled(ctx);

  // Open sequentially so a failure to open B never leaks A's renderer.
  const a = await openRenderer(filePaths[0]);
  let b: PdfRenderer | undefined;
  try {
    b = await openRenderer(filePaths[1]);
    // Only the pages both documents share can be compared; a page-count
    // mismatch is reported via samePageCounts instead of a per-page entry.
    const common = Math.min(a.pageCount, b.pageCount);
    const differingPages: number[] = [];
    const pageSizeMismatchPages: number[] = [];

    for (let i = 0; i < common; i++) {
      assertNotCancelled(ctx);
      const canvasA = await a.renderPage(i, DPI);
      const canvasB = await b.renderPage(i, DPI);

      const pageNumber = i + 1;
      if (
        Math.abs(canvasA.width - canvasB.width) > SIZE_TOLERANCE_PX ||
        Math.abs(canvasA.height - canvasB.height) > SIZE_TOLERANCE_PX
      ) {
        pageSizeMismatchPages.push(pageNumber);
      }
      if (differs(lumaGrid(canvasA), lumaGrid(canvasB))) {
        differingPages.push(pageNumber);
      }

      const done = i + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / common) * 100),
        stage: "comparing",
        pagesDone: done,
      });
    }

    return {
      pageCountA: a.pageCount,
      pageCountB: b.pageCount,
      samePageCounts: a.pageCount === b.pageCount,
      differingPages,
      pageSizeMismatchPages,
    };
  } finally {
    await a.close();
    await b?.close();
  }
}
