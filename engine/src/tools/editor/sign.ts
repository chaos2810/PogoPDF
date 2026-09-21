import { LineCapStyle, StandardFonts, degrees, rgb } from "pdf-lib";
import type { PDFDocument, PDFFont } from "pdf-lib";
import { SignInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadImageEmbeddable } from "../../render/decode";
import { displayedPageSize, toUnrotated } from "../../render/pagegeometry";
import { assertNotCancelled, invalidInput, normalizeAngle } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { encodeFailure, parseHexColor } from "../edit/pagedraw";

const CANONICAL = new Set([0, 90, 180, 270]);

/** Signature ink colour and stroke width (points at scale 1). */
const INK_COLOR = "#1a1a1a";
const INK_WIDTH = 2;
/** The typed signature is a display element, sized well above body copy. */
const TYPE_FONT_SIZE = 24;

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

/** A displayed-frame point (x from left, y from top) in unrotated user space. */
function toUser(disp: DisplayedPage, rx: number, ry: number): { x: number; y: number } {
  return toUnrotated(disp.rotation, disp.mediaW, disp.mediaH, rx, ry);
}

/**
 * Draw a freehand signature as page content. pdf-lib has no bezier/curve path
 * API, so v1 emits one thin round-capped LINE per consecutive point pair (no
 * curve smoothing). The 0..1 normalized inkPoints map onto the displayed page
 * box and (x, y) then translates the whole stroke in displayed points, so
 * x=0,y=0 is the full-page mapping and a small signature can be positioned;
 * `scale` changes the stroke width only, leaving the point mapping intact.
 */
function drawInk(
  doc: PDFDocument,
  pageIndex: number,
  disp: DisplayedPage,
  points: ReadonlyArray<{ x: number; y: number }>,
  x: number,
  y: number,
  scale: number
): void {
  const width = INK_WIDTH * scale;
  const color = parseHexColor(INK_COLOR);
  const mapped = points.map((p) =>
    toUser(disp, p.x * disp.dispW + x, p.y * disp.dispH + y)
  );
  for (let i = 1; i < mapped.length; i++) {
    doc.getPage(pageIndex).drawLine({
      start: mapped[i - 1],
      end: mapped[i],
      thickness: width,
      color: rgb(color.r, color.g, color.b),
      lineCap: LineCapStyle.Round,
    });
  }
}

/**
 * Place a draw, type, or image signature at (x, y) on the chosen page. The
 * anchor and rotation come from the DISPLAYED frame (pagedraw semantics), so a
 * signature lands where the viewer showed the point on a /Rotate page.
 */
export async function runSign(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const parsed = SignInputSchema.parse(input);
  const { filePath, mode, x, y, page, scale } = parsed;
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath);
  const pageCount = doc.getPageCount();
  if (page > pageCount) {
    throw invalidInput(`Signature page ${page} is out of range (1-${pageCount})`);
  }
  const pageIndex = page - 1;
  const disp = displayedPage(doc, pageIndex);

  switch (mode) {
    case "draw": {
      drawInk(doc, pageIndex, disp, parsed.inkPoints!, x, y, scale);
      break;
    }

    case "type": {
      const font: PDFFont = await doc.embedFont(StandardFonts.HelveticaOblique);
      const text = parsed.text!;
      try {
        font.widthOfTextAtSize(text, TYPE_FONT_SIZE * scale);
      } catch (err) {
        throw encodeFailure(err) ?? err;
      }
      const { x: ux, y: uy } = toUser(disp, x, y);
      const color = parseHexColor(INK_COLOR);
      try {
        doc.getPage(pageIndex).drawText(text, {
          x: ux,
          y: uy,
          size: TYPE_FONT_SIZE * scale,
          font,
          color: rgb(color.r, color.g, color.b),
          // Counter the page /Rotate so the glyphs read upright to the viewer.
          rotate: degrees(disp.rotation),
        });
      } catch (err) {
        throw encodeFailure(err) ?? err;
      }
      break;
    }

    case "image": {
      const loaded = await loadImageEmbeddable(parsed.imageFile!);
      const image =
        loaded.kind === "jpg"
          ? await doc.embedJpg(loaded.bytes)
          : await doc.embedPng(loaded.bytes);
      // (x, y) is the image's TOP-LEFT in the displayed frame; drawImage
      // anchors at the lower-left, so the displayed box is (x, y) to
      // (x + w, y + h) and the user-space anchor is the box's lower-left.
      const width = loaded.widthPx * scale;
      const height = loaded.heightPx * scale;
      const anchor = toUser(disp, x, y + height);
      doc.getPage(pageIndex).drawImage(image, {
        x: anchor.x,
        y: anchor.y,
        width,
        height,
        rotate: degrees(disp.rotation),
      });
      break;
    }
  }

  return savePdf(doc, outDir, "signed.pdf");
}
