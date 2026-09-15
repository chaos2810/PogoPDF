import { PDFDocument } from "pdf-lib";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  MergeInputSchema,
  TOOL_ERROR_CODES,
  type ProgressParams,
} from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";

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
    const path = filePaths[i];
    if (!existsSync(path)) {
      throw Object.assign(new Error(`File not found: ${path}`), {
        code: TOOL_ERROR_CODES.CORRUPT_PDF,
      });
    }
    let src: PDFDocument;
    try {
      src = await PDFDocument.load(await readFile(path), {
        ignoreEncryption: false,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = /encrypt/i.test(msg)
        ? TOOL_ERROR_CODES.ENCRYPTED_PDF
        : TOOL_ERROR_CODES.CORRUPT_PDF;
      throw Object.assign(new Error(`Cannot load ${path}: ${msg}`), { code });
    }
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
  const outPath = join(outDir, "merged.pdf");
  const bytes = await out.save();
  await writeFile(outPath, bytes);
  return outPath;
}
