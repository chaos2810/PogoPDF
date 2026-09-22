import { PDFDocument, degrees, type PDFEmbeddedPage, type PDFPage } from "pdf-lib";
import { OverlayInputSchema, TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled, normalizeAngle } from "../organize/organize";
import { displayedPageSize } from "../../render/pagegeometry";
import { loadPdf, savePdf } from "../pdfdoc";

/**
 * A page with no content stream (a genuinely blank page) cannot be embedded:
 * pdf-lib's embedder throws MissingPageContentsEmbeddingError. Blank pages are
 * common, so treat "nothing to draw" as an absent layer instead of a failure.
 * (The throw is deferred to save time, so the check is up front, not a catch.)
 */
async function tryEmbedPage(
  out: PDFDocument,
  page: PDFPage
): Promise<PDFEmbeddedPage | undefined> {
  if (page.node.Contents() === undefined) return undefined;
  return await out.embedPage(page);
}

/**
 * Composes two documents page by page. Both source pages are embedded as Form
 * XObjects (pdf-lib's embedPage carries the raw MediaBox and an identity matrix,
 * so /Rotate is re-applied on the output page).
 *
 * z-order is the only difference between the modes: `overlay` draws the base
 * first then the overlay; `underlay` draws the underlay first then the base, so
 * the base's opaque pixels hide it. The base is always drawn at opacity 1; the
 * secondary document carries `opacity`.
 *
 * Each output page uses the BASE page's displayed frame. The secondary page is
 * drawn at the displayed origin (or scaled to fit and centered when
 * scaleToFit), so a rotated secondary page aligns with the base's displayed
 * content instead of its unrotated axes.
 */
export async function runOverlay(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { baseFilePath, overlayFilePath, mode, opacity, scaleToFit } =
    OverlayInputSchema.parse(input);
  assertNotCancelled(ctx);

  const base = await loadPdf(baseFilePath);
  const overlay = await loadPdf(overlayFilePath);
  const out = await PDFDocument.create();

  const baseCount = base.getPageCount();
  const overlayCount = overlay.getPageCount();
  if (overlayCount === 0) {
    throw Object.assign(new Error("Overlay document has no pages"), {
      code: TOOL_ERROR_CODES.INVALID_INPUT,
    });
  }

  for (let i = 0; i < baseCount; i++) {
    assertNotCancelled(ctx);
    const basePage = base.getPage(i);
    const baseRotation = normalizeAngle(basePage.getRotation().angle);
    const { width: baseMediaW, height: baseMediaH } = basePage.getSize();
    const { width: dispW, height: dispH } = displayedPageSize(
      baseRotation,
      baseMediaW,
      baseMediaH
    );

    const page = out.addPage([dispW, dispH]);

    // pdf-lib embeds the raw MediaBox with identity: re-apply /Rotate. `rotate`
    // is counter-clockwise, /Rotate is clockwise, so negate it.
    const baseRot = (360 - baseRotation) % 360;
    // drawPage rotates around the (x, y) anchor, so the rotated content extends
    // up/right for 90/180/270. Offset the anchor to keep the frame in place.
    const baseX = baseRot === 90 || baseRot === 180 ? dispW : 0;
    const baseY = baseRot === 180 || baseRot === 270 ? dispH : 0;
    const baseEmb = await tryEmbedPage(out, basePage);

    // Repeat the last secondary page once the secondary doc runs out; extra
    // secondary pages beyond the base's count are ignored.
    const secondaryIndex = Math.min(i, overlayCount - 1);
    const secondaryPage = overlay.getPage(secondaryIndex);
    const secondaryRotation = normalizeAngle(secondaryPage.getRotation().angle);
    const { width: secMediaW, height: secMediaH } = secondaryPage.getSize();
    const { width: secDispW, height: secDispH } = displayedPageSize(
      secondaryRotation,
      secMediaW,
      secMediaH
    );
    const secondaryRot = (360 - secondaryRotation) % 360;
    const secondaryEmb = await tryEmbedPage(out, secondaryPage);

    const scale = scaleToFit
      ? Math.min(dispW / secDispW, dispH / secDispH)
      : 1;
    const secondaryW = secDispW * scale;
    const secondaryH = secDispH * scale;
    // scaleToFit centers the scaled page in the base frame; without it the page
    // is drawn at 1:1 at the displayed origin (offset for the rotation anchor).
    const secRot = secondaryRot;
    const secX =
      (scaleToFit ? (dispW - secondaryW) / 2 : 0) +
      (secRot === 90 || secRot === 180 ? secondaryW : 0);
    const secY =
      (scaleToFit ? (dispH - secondaryH) / 2 : 0) +
      (secRot === 180 || secRot === 270 ? secondaryH : 0);

    const drawSecondary = () => {
      if (!secondaryEmb) return;
      page.drawPage(secondaryEmb, {
        x: secX,
        y: secY,
        xScale: scale,
        yScale: scale,
        rotate: degrees(secRot),
        opacity,
      });
    };

    const drawBase = () => {
      if (!baseEmb) return;
      page.drawPage(baseEmb, {
        x: baseX,
        y: baseY,
        xScale: 1,
        yScale: 1,
        rotate: degrees(baseRot),
      });
    };

    if (mode === "overlay") {
      drawBase();
      drawSecondary();
    } else {
      drawSecondary();
      drawBase();
    }

    const done = i + 1;
    ctx.notifyProgress({
      jobId: "",
      percent: Math.round((done / baseCount) * 100),
      stage: "overlaying",
      pagesDone: done,
    });
  }

  return savePdf(out, outDir, "overlay.pdf");
}
