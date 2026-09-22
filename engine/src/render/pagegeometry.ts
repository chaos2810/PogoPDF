/**
 * Page-rotation geometry shared by every tool that must reason in the viewer's
 * frame (edit stamps/crop, rasterize, fix-page-size). A page's /Rotate changes
 * what the viewer displays without changing the unrotated MediaBox, so these
 * helpers convert between the two spaces.
 */

import type { PDFDocument, PDFImage } from "pdf-lib";
import { normalizeAngle } from "../tools/organize/organize";

/** The page's size as displayed by a viewer under its (canonical) /Rotate. */
export function displayedPageSize(
  rotationDeg: number,
  wPt: number,
  hPt: number
): { width: number; height: number } {
  const swaps = rotationDeg === 90 || rotationDeg === 270;
  return { width: swaps ? hPt : wPt, height: swaps ? wPt : hPt };
}

/**
 * Add a page to `out` sized to source page `pageIndex` as displayed (its
 * /Rotate applied) and draw `image` full-page over it. Used by every raster
 * rebuild: the raster already carries the rotation, so the output page must use
 * the displayed dimensions, not the raw MediaBox.
 */
export function addFullPageImage(
  out: PDFDocument,
  src: PDFDocument,
  pageIndex: number,
  image: PDFImage
): void {
  const { width, height } = src.getPage(pageIndex).getSize();
  const rotation = normalizeAngle(src.getPage(pageIndex).getRotation().angle);
  const displayed = displayedPageSize(rotation, width, height);
  const page = out.addPage([displayed.width, displayed.height]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
  });
}

/**
 * Convert a baseline anchor in DISPLAYED space (x from the left, y from the
 * top) back to the page's unrotated user space. Derived by composing pdf.js's
 * viewport matrix for each /Rotate with the text matrix produced by drawing at
 * `rotate: degrees(rotation)` (see the rotation test in edit.test.ts).
 */
export function toUnrotated(
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
