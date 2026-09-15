import { PDFDocument } from "pdf-lib";
import {
  MergeInputSchema,
  TOOL_ERROR_CODES,
  type ProgressParams,
} from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";

export async function runMerge(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePaths } = MergeInputSchema.parse(input);

  const out = await PDFDocument.create();
  for (let i = 0; i < filePaths.length; i++) {
    if (ctx.cancelled()) {
      throw Object.assign(new Error("Job cancelled"), {
        code: TOOL_ERROR_CODES.CANCELLED,
      });
    }
    const src = await loadPdf(filePaths[i]);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    const done = i + 1;
    ctx.notifyProgress({
      jobId: "", // filled by engine wrapper
      percent: Math.round((done / filePaths.length) * 100),
      stage: "merging",
      pagesDone: out.getPageCount(),
    } satisfies ProgressParams);
  }
  return savePdf(out, outDir, "merged.pdf");
}
