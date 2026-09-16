import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { PdfToImagesInputSchema, parsePageSelection } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { encodeCanvas } from "../../render/encode";
import { assertNotCancelled } from "../organize/organize";
import { openRenderer } from "./shared";

export async function runPdfToImages(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string[]> {
  const { filePath, format, dpi, pages, quality } =
    PdfToImagesInputSchema.parse(input);
  assertNotCancelled(ctx);

  const renderer = await openRenderer(filePath);
  try {
    const selected =
      pages === undefined
        ? Array.from({ length: renderer.pageCount }, (_, i) => i)
        : parsePageSelection(pages, renderer.pageCount);
    const stem = basename(filePath, extname(filePath));
    // quality is meaningful only for jpg/webp (the schema enforces this); the
    // 80 default lives here rather than in the schema so png/bmp/tiff omit it.
    const q = format === "jpg" || format === "webp" ? quality ?? 80 : undefined;
    const out: string[] = [];

    for (let n = 0; n < selected.length; n++) {
      assertNotCancelled(ctx);
      const canvas = await renderer.renderPage(selected[n], dpi);
      const buf = await encodeCanvas(canvas, format, q);
      const outPath = join(outDir, `${stem}-${n + 1}.${format}`);
      await writeFile(outPath, buf);
      out.push(outPath);
      const done = n + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / selected.length) * 100),
        stage: "rendering",
        pagesDone: done,
      });
    }
    return out;
  } finally {
    await renderer.close();
  }
}
