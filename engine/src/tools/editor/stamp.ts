import { StandardFonts, degrees, rgb } from "pdf-lib";
import type { PDFDocument } from "pdf-lib";
import { StampInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { displayedPageSize, toUnrotated } from "../../render/pagegeometry";
import { assertNotCancelled, invalidInput, normalizeAngle } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { encodeFailure, parseHexColor } from "../edit/pagedraw";

const CANONICAL = new Set([0, 90, 180, 270]);

/**
 * Stamp font size. The schema has no size field (the UI exposes only text,
 * position, colour, and rotation), so the engine fixes it at a display size
 * that reads as a stamp rather than body copy.
 */
const STAMP_FONT_SIZE = 24;

type DisplayedPage = {
  rotation: number;
  mediaW: number;
  mediaH: number;
  dispW: number;
  dispH: number;
};

function displayedPage(doc: PDFDocument, pageIndex: number): DisplayedPage {
  const page = doc.getPage(pageIndex);
  const raw = normalizeAngle(page.getRotation().angle);
  const rotation = CANONICAL.has(raw) ? raw : 0;
  const { width: mediaW, height: mediaH } = page.getSize();
  const { width: dispW, height: dispH } = displayedPageSize(rotation, mediaW, mediaH);
  return { rotation, mediaW, mediaH, dispW, dispH };
}

/**
 * Stamp text at a displayed-frame baseline anchor, with an optional visual
 * rotation and colour. A thin wrapper over the page-drawing primitives: the
 * page /Rotate is countered so `rotate` is measured in displayed space (see
 * watermark's stampText, the same math). Text is WinAnsi-only.
 */
export async function runStamp(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, text, page, x, y, color, rotate } = StampInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath);
  const pageCount = doc.getPageCount();
  if (page > pageCount) {
    throw invalidInput(`Stamp page ${page} is out of range (1-${pageCount})`);
  }

  const pageIndex = page - 1;
  const disp = displayedPage(doc, pageIndex);
  const parsed = parseHexColor(color);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  try {
    font.widthOfTextAtSize(text, STAMP_FONT_SIZE);
  } catch (err) {
    throw encodeFailure(err) ?? err;
  }

  const { x: ux, y: uy } = toUnrotated(disp.rotation, disp.mediaW, disp.mediaH, x, y);
  try {
    doc.getPage(pageIndex).drawText(text, {
      x: ux,
      y: uy,
      size: STAMP_FONT_SIZE,
      font,
      color: rgb(parsed.r, parsed.g, parsed.b),
      rotate: degrees(disp.rotation + rotate),
    });
  } catch (err) {
    throw encodeFailure(err) ?? err;
  }

  return savePdf(doc, outDir, "stamped.pdf");
}
