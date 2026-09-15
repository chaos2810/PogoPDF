import { PDFDocument } from "pdf-lib";
import { BookletInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled } from "./organize";

// Duplex booklet imposition for a page count padded to a multiple of 4.
// Per sheet s (0-based) the order is [n-2s, 2s+1, 2s+2, n-2s-1] (1-based),
// e.g. n=8 → 8,1,2,7,6,3,4,5.
export function bookletOrder(padded: number): number[] {
  const order: number[] = [];
  for (let s = 0; s < padded / 4; s++) {
    order.push(padded - 1 - 2 * s);
    order.push(2 * s);
    order.push(2 * s + 1);
    order.push(padded - 2 - 2 * s);
  }
  return order;
}

export async function runBooklet(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath } = BookletInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const count = src.getPageCount();
  if (count === 0) return savePdf(await PDFDocument.create(), outDir, "booklet.pdf");

  const padded = Math.ceil(count / 4) * 4;

  // Natural-order staging doc: all source pages, then blank padding pages sized
  // to the first page.
  const staging = await PDFDocument.create();
  const copied = await staging.copyPages(
    src,
    src.getPageIndices()
  );
  copied.forEach((p) => staging.addPage(p));
  const blankSize: [number, number] = [
    src.getPage(0).getWidth(),
    src.getPage(0).getHeight(),
  ];
  for (let i = count; i < padded; i++) staging.addPage(blankSize);

  const out = await PDFDocument.create();
  const ordered = await out.copyPages(staging, bookletOrder(padded));
  ordered.forEach((p) => out.addPage(p));
  return savePdf(out, outDir, "booklet.pdf");
}
