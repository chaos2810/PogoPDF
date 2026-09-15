import {
  DeletePagesInputSchema,
  parsePageSelection,
} from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled, buildFromPages } from "./organize";

export async function runDelete(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, pages } = DeletePagesInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const selected = new Set(parsePageSelection(pages, src.getPageCount()));
  const kept = src
    .getPageIndices()
    .filter((i) => !selected.has(i))
    .map((index) => ({ index }));
  const out = await buildFromPages(src, kept);
  return savePdf(out, outDir, "deleted.pdf");
}
