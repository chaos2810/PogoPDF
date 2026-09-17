import { StandardFonts, degrees, rgb } from "pdf-lib";
import type { PDFDocument, PDFFont } from "pdf-lib";
import { invalidInput, normalizeAngle } from "../organize/organize";

export type TextPosition =
  | "top-center"
  | "top-left"
  | "top-right"
  | "bottom-center"
  | "bottom-left"
  | "bottom-right";

export type DrawTextOptions = {
  position: TextPosition;
  fontSize: number;
  margin: number;
  /** #rrggbb; defaults to black. */
  color?: string;
};

/** Helvetica is a standard PDF font: embed once per document, then pass in. */
export async function embedStandardFont(doc: PDFDocument): Promise<PDFFont> {
  return doc.embedFont(StandardFonts.Helvetica);
}

export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw invalidInput(`Color must be a #rrggbb hex string: ${hex}`);
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}

const CANONICAL = new Set([0, 90, 180, 270]);

/**
 * Convert a baseline anchor in DISPLAYED space (x from the left, y from the
 * top) back to the page's unrotated user space. Derived by composing pdf.js's
 * viewport matrix for each /Rotate with the text matrix produced by drawing at
 * `rotate: degrees(rotation)` (see the rotation test in edit.test.ts).
 */
function toUnrotated(
  rotation: number,
  width: number,
  height: number,
  rx: number,
  ry: number
): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: ry, y: rx };
    case 180:
      return { x: width - rx, y: ry };
    case 270:
      return { x: width - ry, y: height - rx };
    default:
      return { x: rx, y: height - ry };
  }
}

/**
 * Draw `text` on one page so it appears upright in the viewer at `position`,
 * measured from the displayed (rotation-aware) page edges. Existing page
 * content is untouched; pdf-lib appends the new text to the content stream.
 */
export function drawPageText(
  doc: PDFDocument,
  pageIndex: number,
  text: string,
  font: PDFFont,
  opts: DrawTextOptions
): void {
  const page = doc.getPage(pageIndex);
  const raw = normalizeAngle(page.getRotation().angle);
  // PDF /Rotate is specified as a multiple of 90; anything else is malformed.
  const rotation = CANONICAL.has(raw) ? raw : 0;

  const { width: mediaW, height: mediaH } = page.getSize();
  const swaps = rotation === 90 || rotation === 270;
  const dispW = swaps ? mediaH : mediaW;
  const dispH = swaps ? mediaW : mediaH;

  const [vertical, horizontal] = opts.position.split("-");
  const textWidth = font.widthOfTextAtSize(text, opts.fontSize);
  const textHeight = font.heightAtSize(opts.fontSize);

  const rx =
    horizontal === "left"
      ? opts.margin
      : horizontal === "right"
        ? dispW - opts.margin - textWidth
        : (dispW - textWidth) / 2;
  // Top: the text box top sits `margin` from the top edge. Bottom: the
  // baseline sits `margin` above the bottom edge.
  const ry = vertical === "top" ? opts.margin + textHeight : dispH - opts.margin;

  const { x, y } = toUnrotated(rotation, mediaW, mediaH, rx, ry);
  const color = opts.color ? parseHexColor(opts.color) : undefined;
  page.drawText(text, {
    x,
    y,
    size: opts.fontSize,
    font,
    color: color ? rgb(color.r, color.g, color.b) : undefined,
    // Counter the viewer's clockwise /Rotate so the glyphs read upright.
    rotate: degrees(rotation),
  });
}
