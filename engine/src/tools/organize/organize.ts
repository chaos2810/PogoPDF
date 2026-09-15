import { PDFDocument, degrees } from "pdf-lib";

export type PageOp = { index: number; rotate?: 0 | 90 | 180 | 270 };

// `rotate` is absolute (organize-grid semantics), so setRotation replaces any
// existing /Rotate rather than accumulating. Duplicate indices are allowed.
export async function buildFromPages(
  src: PDFDocument,
  pages: PageOp[]
): Promise<PDFDocument> {
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
