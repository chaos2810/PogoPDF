import {
  ExtractPagesInputSchema,
  parsePageSelection,
} from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled, buildFromPages } from "./organize";

export async function runExtract(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, pages } = ExtractPagesInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  // Selection is always normalized ascending; the organize grid handles custom order.
  const indices = parsePageSelection(pages, src.getPageCount());
  const out = await buildFromPages(
    src,
    indices.map((index) => ({ index }))
  );
  return savePdf(out, outDir, "extracted.pdf");
}
