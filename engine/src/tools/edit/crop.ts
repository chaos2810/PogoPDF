import { CropInputSchema, parsePageSelection } from "@pogopdf/contracts";
import type { ProgressParams } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled, invalidInput, normalizeAngle } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { displayedPageSize, toUnrotated } from "../../render/pagegeometry";

const CANONICAL = new Set([0, 90, 180, 270]);
const MIN_BOX_PT = 10;

/**
 * Crop insets apply to the DISPLAYED page edges (what the viewer shows), so they
 * must be mapped onto the underlying MediaBox axes. `toUnrotated` gives the
 * inverse of pdf.js's viewport transform for each /Rotate: project the four
 * displayed corners of the inset rectangle back into unrotated user space, then
 * take their bounding box. Non-zero MediaBox origins are accounted for by
 * working in local coordinates first.
 */
function croppedRect(
  rotationDeg: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  insets: { top: number; bottom: number; left: number; right: number }
): { x: number; y: number; width: number; height: number } {
  const { width: dispW, height: dispH } = displayedPageSize(rotationDeg, w, h);
  const local = (rx: number, ry: number) => toUnrotated(rotationDeg, w, h, rx, ry);
  const cornerX = [insets.left, dispW - insets.right];
  const cornerY = [insets.top, dispH - insets.bottom];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rx of cornerX) {
    for (const ry of cornerY) {
      const { x, y } = local(rx, ry);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { x: x0 + minX, y: y0 + minY, width: maxX - minX, height: maxY - minY };
}

export async function runCrop(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, pages, ...insets } = CropInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath);
  const selected =
    pages === undefined ? doc.getPageIndices() : parsePageSelection(pages, doc.getPageCount());

  for (let n = 0; n < selected.length; n++) {
    assertNotCancelled(ctx);
    const page = doc.getPage(selected[n]);
    const raw = normalizeAngle(page.getRotation().angle);
    const rotation = CANONICAL.has(raw) ? raw : 0;
    const { x: x0, y: y0, width, height } = page.getMediaBox();

    // Guard against the displayed box going below the minimum BEFORE mapping:
    // insets larger than the axis would otherwise produce an inverted rectangle
    // whose bounding box is positive (and therefore appears valid).
    const disp = displayedPageSize(rotation, width, height);
    const keepW = disp.width - insets.left - insets.right;
    const keepH = disp.height - insets.top - insets.bottom;
    if (keepW < MIN_BOX_PT || keepH < MIN_BOX_PT) {
      throw invalidInput(
        `Crop leaves a ${keepW.toFixed(1)}x${keepH.toFixed(1)}pt page ` +
          `(minimum ${MIN_BOX_PT}pt on each axis)`
      );
    }

    const rect = croppedRect(rotation, x0, y0, width, height, insets);
    page.setMediaBox(rect.x, rect.y, rect.width, rect.height);
    page.setCropBox(rect.x, rect.y, rect.width, rect.height);

    const done = n + 1;
    ctx.notifyProgress({
      jobId: "",
      percent: Math.round((done / selected.length) * 100),
      stage: "cropping",
      pagesDone: done,
    } satisfies ProgressParams);
  }

  return savePdf(doc, outDir, "cropped.pdf");
}
