import { PDFDocument } from "pdf-lib";
import { CombineSinglePageInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled } from "./organize";

type Align = "start" | "center" | "end";
type Direction = "vertical" | "horizontal";

export type PageBox = { width: number; height: number };
export type Layout = {
  width: number;
  height: number;
  positions: Array<{ x: number; y: number }>;
};

// vertical: pages stack top-to-bottom (first page at the top); `align` positions
// each page on the horizontal (cross) axis. horizontal: pages run left-to-right;
// `align` positions each page vertically. PDF origin is bottom-left.
export function computeLayout(
  pages: PageBox[],
  direction: Direction,
  align: Align
): Layout {
  if (direction === "vertical") {
    const width = Math.max(...pages.map((p) => p.width));
    const height = pages.reduce((sum, p) => sum + p.height, 0);
    let top = height;
    const positions = pages.map((p) => {
      top -= p.height;
      const free = width - p.width;
      const x = align === "start" ? 0 : align === "center" ? free / 2 : free;
      return { x, y: top };
    });
    return { width, height, positions };
  }

  const width = pages.reduce((sum, p) => sum + p.width, 0);
  const height = Math.max(...pages.map((p) => p.height));
  let left = 0;
  const positions = pages.map((p) => {
    const x = left;
    left += p.width;
    const free = height - p.height;
    const y = align === "start" ? free : align === "center" ? free / 2 : 0;
    return { x, y };
  });
  return { width, height, positions };
}

export async function runCombineSinglePage(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, direction, align } =
    CombineSinglePageInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const boxes: PageBox[] = src
    .getPages()
    .map((p) => ({ width: p.getWidth(), height: p.getHeight() }));
  const layout = computeLayout(boxes, direction, align);

  const out = await PDFDocument.create();
  const embedded = await out.embedPages(src.getPages());
  const page = out.addPage([layout.width, layout.height]);
  embedded.forEach((emb, i) => {
    page.drawPage(emb, layout.positions[i]);
  });
  return savePdf(out, outDir, "combined.pdf");
}
