import { PDFDocument } from "pdf-lib";
import { AlternateMixInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled } from "./organize";

// "alternate": A1,B1,A2,B2,… leftover pages of the longer file append in order.
// "inverse": A ascending interleaved with B descending (A1,Bn,A2,Bn-1,…); the
// longer file's leftover pages append in that same direction.
function mixOrder(
  countA: number,
  countB: number,
  order: "alternate" | "inverse"
): Array<{ from: 0 | 1; index: number }> {
  const b = order === "inverse"
    ? Array.from({ length: countB }, (_, i) => countB - 1 - i)
    : Array.from({ length: countB }, (_, i) => i);
  const out: Array<{ from: 0 | 1; index: number }> = [];
  const max = Math.max(countA, countB);
  for (let i = 0; i < max; i++) {
    if (i < countA) out.push({ from: 0, index: i });
    if (i < countB) out.push({ from: 1, index: b[i] });
  }
  return out;
}

export async function runAlternateMix(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePaths, order } = AlternateMixInputSchema.parse(input);
  assertNotCancelled(ctx);

  const sources = await Promise.all([loadPdf(filePaths[0]), loadPdf(filePaths[1])]);
  const steps = mixOrder(
    sources[0].getPageCount(),
    sources[1].getPageCount(),
    order
  );

  const out = await PDFDocument.create();
  for (const step of steps) {
    assertNotCancelled(ctx);
    const [page] = await out.copyPages(sources[step.from], [step.index]);
    out.addPage(page);
  }
  return savePdf(out, outDir, "alternated.pdf");
}
