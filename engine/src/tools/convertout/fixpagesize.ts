import { PDFDocument, degrees } from "pdf-lib";
import { FixPageSizeInputSchema } from "@pogopdf/contracts";
import type { FixPageSizeInput } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled, normalizeAngle } from "../organize/organize";
import { displayedPageSize } from "../../render/pagegeometry";
import { loadPdf, savePdf } from "../pdfdoc";

// Portrait dimensions in points (ISO 216 / US Letter at 72 dpi).
const SIZES: Record<FixPageSizeInput["size"], [number, number]> = {
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
  letter: [612, 792],
};

export async function runFixPageSize(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, size, orientation, fit } = FixPageSizeInputSchema.parse(input);
  assertNotCancelled(ctx);

  const [w, h] = SIZES[size];
  const targetW = orientation === "landscape" ? h : w;
  const targetH = orientation === "landscape" ? w : h;

  const src = await loadPdf(filePath);
  const out = await PDFDocument.create();

  for (let i = 0; i < src.getPageCount(); i++) {
    assertNotCancelled(ctx);
    const srcPage = src.getPage(i);
    const rotation = normalizeAngle(srcPage.getRotation().angle);
    // /Rotate turns the page in the viewer, so the box the user sees swaps
    // width and height for 90/270 even though the MediaBox is unchanged.
    const { width: mediaW, height: mediaH } = srcPage.getSize();
    const { width: dispW, height: dispH } = displayedPageSize(rotation, mediaW, mediaH);

    // scale: always fit (may upscale). pad: fit only when the source overflows,
    // otherwise draw at 1:1 so smaller pages keep their true size. The fit is
    // computed against the DISPLAYED dims so orientation is preserved.
    const fitScale = Math.min(targetW / dispW, targetH / dispH);
    const scale = fit === "scale" ? fitScale : Math.min(1, fitScale);
    const drawW = dispW * scale;
    const drawH = dispH * scale;

    // pdf-lib embeds the raw MediaBox with an identity matrix: /Rotate is not
    // carried into the Form XObject. Re-apply it here. pdf-lib's `rotate`
    // option is counter-clockwise, while /Rotate is clockwise, so negate it.
    const drawRot = (360 - rotation) % 360;

    // `drawPage` rotates around the (x, y) anchor, so the rotated content
    // extends up/right of it for 90/180/270. Offset the anchor by the rotated
    // extent to keep the drawn box centered on the target page.
    const x = (targetW - drawW) / 2 + (drawRot === 90 || drawRot === 180 ? drawW : 0);
    const y = (targetH - drawH) / 2 + (drawRot === 180 || drawRot === 270 ? drawH : 0);

    // One page embedded at a time: the Form XObject is decoded lazily, but
    // holding only the current PDFEmbeddedPage avoids retaining every source
    // page for the lifetime of the job.
    const emb = await out.embedPage(srcPage);
    const page = out.addPage([targetW, targetH]);
    page.drawPage(emb, {
      x,
      y,
      xScale: scale,
      yScale: scale,
      rotate: degrees(drawRot),
    });
  }

  return savePdf(out, outDir, "resized.pdf");
}
