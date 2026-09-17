import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { PrepareForAiInputSchema, parsePageSelection } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { extractPageText } from "../../render/textextract";
import { assertNotCancelled } from "../organize/organize";
import { openRenderer } from "../convertout/shared";

/**
 * LlamaIndex-style plain-text JSON for LLM ingestion: one entry per selected
 * page with its 1-based number and extracted text, plus a metadata block. Text
 * is read verbatim from the PDF's own text layer, so scanned pages without one
 * come through empty.
 */
export async function runPrepareForAi(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, pages } = PrepareForAiInputSchema.parse(input);
  assertNotCancelled(ctx);

  const renderer = await openRenderer(filePath);
  try {
    const selected =
      pages === undefined
        ? Array.from({ length: renderer.pageCount }, (_, i) => i)
        : parsePageSelection(pages, renderer.pageCount);
    const out: Array<{ page: number; text: string }> = [];

    for (let n = 0; n < selected.length; n++) {
      assertNotCancelled(ctx);
      const page = await renderer.getPage(selected[n]);
      out.push({ page: selected[n] + 1, text: await extractPageText(page) });
      const done = n + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / selected.length) * 100),
        stage: "extracting",
        pagesDone: done,
      });
    }

    const payload = { metadata: { pageCount: renderer.pageCount }, pages: out };
    const outPath = join(outDir, `${basename(filePath, extname(filePath))}.json`);
    await writeFile(outPath, JSON.stringify(payload, null, 2));
    return outPath;
  } finally {
    await renderer.close();
  }
}
