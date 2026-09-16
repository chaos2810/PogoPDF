import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { PdfToTextInputSchema, parsePageSelection } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { extractAllText } from "../../render/textextract";
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
        ? undefined
        : parsePageSelection(pages, renderer.pageCount);

    const text = await extractAllText(
      renderer,
      selected,
      (_index, position) => {
        const done = position + 1;
        const total = selected?.length ?? renderer.pageCount;
        ctx.notifyProgress({
          jobId: "",
          percent: Math.round((done / total) * 100),
          stage: "extracting",
          pagesDone: done,
        });
      },
      () => assertNotCancelled(ctx)
    );

    const outPath = join(outDir, `${basename(filePath, extname(filePath))}.txt`);
    await writeFile(outPath, text);
    return outPath;
  } finally {
    await renderer.close();
  }
}
