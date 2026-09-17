import { degrees, rgb } from "pdf-lib";
import type { PDFDocument, PDFFont, PDFImage } from "pdf-lib";
import { WatermarkInputSchema, parsePageSelection } from "@pogopdf/contracts";
import type { ProgressParams } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import {
  assertNotCancelled,
  invalidInput,
  normalizeAngle,
} from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { loadImageEmbeddable } from "../../render/decode";
import { displayedPageSize, toUnrotated } from "../../render/pagegeometry";
import { embedStandardFont, encodeFailure, parseHexColor } from "./pagedraw";

const CANONICAL = new Set([0, 90, 180, 270]);

/** Page geometry in DISPLAYED (rotation-aware) space. */
type DisplayedPage = {
  pageRotation: number;
  mediaW: number;
  mediaH: number;
  dispW: number;
  dispH: number;
};

function displayedPage(doc: PDFDocument, pageIndex: number): DisplayedPage {
  const page = doc.getPage(pageIndex);
  const raw = normalizeAngle(page.getRotation().angle);
  const pageRotation = CANONICAL.has(raw) ? raw : 0;
  const { width: mediaW, height: mediaH } = page.getSize();
  const { width: dispW, height: dispH } = displayedPageSize(pageRotation, mediaW, mediaH);
  return {
    pageRotation,
    mediaW,
    mediaH,
    dispW,
    dispH,
  };
}

type TextStamp = {
  text: string;
  font: PDFFont;
  textWidth: number;
  fontSize: number;
  /** Requested visual rotation, degrees CCW in displayed space. */
  rotation: number;
  color: { r: number; g: number; b: number };
  opacity: number;
};

/**
 * Draw one text stamp with its BASELINE START at displayed (rx, ry). The page's
 * /Rotate is countered so `rotation` is measured in displayed space (see
 * pagegeometry.toUnrotated): visual angle == draw angle - pageRotation.
 */
function stampText(
  doc: PDFDocument,
  pageIndex: number,
  disp: DisplayedPage,
  rx: number,
  ry: number,
  stamp: TextStamp
): void {
  const { x, y } = toUnrotated(disp.pageRotation, disp.mediaW, disp.mediaH, rx, ry);
  try {
    doc.getPage(pageIndex).drawText(stamp.text, {
      x,
      y,
      size: stamp.fontSize,
      font: stamp.font,
      color: rgb(stamp.color.r, stamp.color.g, stamp.color.b),
      opacity: stamp.opacity,
      rotate: degrees(disp.pageRotation + stamp.rotation),
    });
  } catch (err) {
    throw encodeFailure(err) ?? err;
  }
}

/** One stamp centered on the displayed page, rotated about the string midpoint. */
function drawCentered(
  doc: PDFDocument,
  pageIndex: number,
  disp: DisplayedPage,
  stamp: TextStamp
): void {
  const rad = (stamp.rotation * Math.PI) / 180;
  // Displayed space y grows downward, so a CCW visual rotation advances the
  // baseline along (cos, -sin); offset the anchor back by half the advance.
  const rx = disp.dispW / 2 - (stamp.textWidth / 2) * Math.cos(rad);
  const ry = disp.dispH / 2 + (stamp.textWidth / 2) * Math.sin(rad);
  stampText(doc, pageIndex, disp, rx, ry, stamp);
}

/**
 * A grid of stamps covering the displayed box (overflow past the page edges is
 * expected for tiles). Alternate rows are staggered by half a column.
 */
function drawTiled(
  doc: PDFDocument,
  pageIndex: number,
  disp: DisplayedPage,
  stamp: TextStamp
): void {
  const stepX = stamp.textWidth + 60;
  const stepY = stamp.fontSize * 2 + 40;
  let row = 0;
  for (let ry = -stepY; ry < disp.dispH + stepY; ry += stepY) {
    const stagger = row % 2 === 0 ? 0 : -stepX / 2;
    for (let rx = stagger - stepX; rx < disp.dispW + stepX; rx += stepX) {
      stampText(doc, pageIndex, disp, rx, ry, stamp);
    }
    row++;
  }
}

export async function runWatermark(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, text, imagePath, opacity, fontSize, rotation, color, pages, position } =
    WatermarkInputSchema.parse(input);
  assertNotCancelled(ctx);

  // The schema allows a present-but-empty string; an empty watermark is a
  // silent no-op, so reject it as bad input instead.
  const trimmedText = text?.trim();
  if (text !== undefined && !trimmedText) {
    throw invalidInput("Watermark text must be non-empty");
  }

  const doc = await loadPdf(filePath);
  const selected =
    pages === undefined
      ? doc.getPageIndices()
      : parsePageSelection(pages, doc.getPageCount());

  const font = trimmedText ? await embedStandardFont(doc) : undefined;
  let stamp: TextStamp | undefined;
  if (trimmedText && font) {
    let textWidth: number;
    try {
      textWidth = font.widthOfTextAtSize(trimmedText, fontSize);
    } catch (err) {
      throw encodeFailure(err) ?? err;
    }
    stamp = {
      text: trimmedText,
      font,
      textWidth,
      fontSize,
      rotation,
      color: parseHexColor(color),
      opacity,
    };
  }

  let image: PDFImage | undefined;
  if (imagePath) {
    // Embedded once per document; pdf-lib reuses the XObject across pages.
    const loaded = await loadImageEmbeddable(imagePath);
    image =
      loaded.kind === "jpg" ? await doc.embedJpg(loaded.bytes) : await doc.embedPng(loaded.bytes);
  }

  for (let n = 0; n < selected.length; n++) {
    assertNotCancelled(ctx);
    const index = selected[n];
    const disp = displayedPage(doc, index);

    if (stamp) {
      if (position === "tile") drawTiled(doc, index, disp, stamp);
      else drawCentered(doc, index, disp, stamp);
    } else if (image) {
      // Image v1 ignores `rotation`; it is placed upright at the displayed
      // center, scaled to half the displayed page width (aspect preserved).
      const width = disp.dispW * 0.5;
      const height = width * (image.height / image.width);
      const rx = disp.dispW / 2 - width / 2;
      const ry = disp.dispH / 2 + height / 2;
      const { x, y } = toUnrotated(disp.pageRotation, disp.mediaW, disp.mediaH, rx, ry);
      doc.getPage(index).drawImage(image, {
        x,
        y,
        width,
        height,
        opacity,
        rotate: degrees(disp.pageRotation),
      });
    }

    const done = n + 1;
    ctx.notifyProgress({
      jobId: "",
      percent: Math.round((done / selected.length) * 100),
      stage: "watermarking",
      pagesDone: done,
    } satisfies ProgressParams);
  }

  return savePdf(doc, outDir, "watermarked.pdf");
}
