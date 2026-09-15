import { PDFDocument, degrees } from "pdf-lib";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";

export type PageOp = { index: number; rotate?: 0 | 90 | 180 | 270 };

export function invalidInput(message: string): Error {
  return Object.assign(new Error(message), {
    code: TOOL_ERROR_CODES.INVALID_INPUT,
  });
}

export function assertNotCancelled(ctx: { cancelled: () => boolean }): void {
  if (ctx.cancelled()) {
    throw Object.assign(new Error("Job cancelled"), {
      code: TOOL_ERROR_CODES.CANCELLED,
    });
  }
}

export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

// `rotate` is absolute (organize-grid semantics), so setRotation replaces any
// existing /Rotate rather than accumulating. Duplicate indices are allowed.
export async function buildFromPages(
  src: PDFDocument,
  pages: PageOp[]
): Promise<PDFDocument> {
  const count = src.getPageCount();
  for (const p of pages) {
    if (p.index < 0 || p.index >= count) {
      throw invalidInput(`Source page index ${p.index} out of range (0-${count - 1})`);
    }
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    src,
    pages.map((p) => p.index)
  );
  copied.forEach((page, i) => {
    const rotate = pages[i].rotate;
    if (rotate !== undefined) page.setRotation(degrees(rotate));
    out.addPage(page);
  });
  return out;
}
