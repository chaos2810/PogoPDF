import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { PdfToTextInputSchema, parsePageSelection } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { extractPageText } from "../../render/textextract";
import { assertNotCancelled } from "../organize/organize";
import { openRenderer } from "./shared";

export async function runPdfToText(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, pages } = PdfToTextInputSchema.parse(input);
  assertNotCancelled(ctx);

  const renderer = await openRenderer(filePath);
  try {
    const selected =
      pages === undefined
        ? Array.from({ length: renderer.pageCount }, (_, i) => i)
        : parsePageSelection(pages, renderer.pageCount);
    const texts: string[] = [];

    for (let n = 0; n < selected.length; n++) {
      assertNotCancelled(ctx);
      const page = await renderer.getPage(selected[n]);
      texts.push(await extractPageText(page));
      const done = n + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / selected.length) * 100),
        stage: "extracting",
        pagesDone: done,
      });
    }

    const outPath = join(outDir, `${basename(filePath, extname(filePath))}.txt`);
    await writeFile(outPath, texts.join("\f"));
    return outPath;
  } finally {
    await renderer.close();
  }
}
