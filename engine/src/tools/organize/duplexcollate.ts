import { DuplexCollateInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled, buildFromPages, invalidInput } from "./organize";

// A duplex scan is stored as all fronts then all backs (backs in reverse scan
// order). Reorder to reading order: page1, pageN, page2, pageN-1, …
export async function runDuplexCollate(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath } = DuplexCollateInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const count = src.getPageCount();
  if (count % 2 !== 0) {
    throw invalidInput(`Duplex collate requires an even page count, got ${count}`);
  }

  const half = count / 2;
  const order: number[] = [];
  for (let i = 0; i < half; i++) {
    order.push(i); // front i+1
    order.push(count - 1 - i); // back i+1 (last scanned page first)
  }
  const out = await buildFromPages(
    src,
    order.map((index) => ({ index }))
  );
  return savePdf(out, outDir, "collated.pdf");
}
