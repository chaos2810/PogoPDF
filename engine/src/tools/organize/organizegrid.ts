import { OrganizeInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled, buildFromPages } from "./organize";

// The drag grid emits an ordered page list; `rotate` is absolute (see
// buildFromPages). Bounds checking lives in buildFromPages.
export async function runOrganizeGrid(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, pages } = OrganizeInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const out = await buildFromPages(
    src,
    pages.map((p) => ({ index: p.srcIndex, rotate: p.rotate }))
  );
  return savePdf(out, outDir, "organized.pdf");
}
