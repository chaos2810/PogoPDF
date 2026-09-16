import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { PdfToCbzInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { encodeCanvas } from "../../render/encode";
import { assertNotCancelled } from "../organize/organize";
import { openRenderer } from "./shared";

/**
 * A .cbz is a plain zip of page images, so pages are rendered at `dpi`, png
 * encoded, and added as page-001.png… (zero-padded to 3 for comic readers that
 * sort names lexically). Deflate is the jszip default; readers accept it.
 */
export async function runPdfToCbz(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, dpi } = PdfToCbzInputSchema.parse(input);
  assertNotCancelled(ctx);

  const renderer = await openRenderer(filePath);
  try {
    const zip = new JSZip();
    for (let i = 0; i < renderer.pageCount; i++) {
      assertNotCancelled(ctx);
      const canvas = await renderer.renderPage(i, dpi);
      const png = await encodeCanvas(canvas, "png");
      zip.file(`page-${String(i + 1).padStart(3, "0")}.png`, png);
      const done = i + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / renderer.pageCount) * 100),
        stage: "rendering",
        pagesDone: done,
      });
    }

    const buf = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    const stem = basename(filePath, extname(filePath));
    const outPath = join(outDir, `${stem}.cbz`);
    await writeFile(outPath, buf);
    return outPath;
  } finally {
    await renderer.close();
  }
}
