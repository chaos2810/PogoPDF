import { ReverseInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled, buildFromPages } from "./organize";

export async function runReverse(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath } = ReverseInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const reversed = src
    .getPageIndices()
    .reverse()
    .map((index) => ({ index }));
  const out = await buildFromPages(src, reversed);
  return savePdf(out, outDir, "reversed.pdf");
}
