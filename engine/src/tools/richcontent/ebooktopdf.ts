import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { EbookToPdfInputSchema, TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { RichDocument } from "../../render/mupdfengine";
import { assertNotCancelled } from "../organize/organize";

/**
 * EPUB/FB2 -> PDF. mupdf lays the reflowable book out onto A4 pages using the
 * requested base font size and page margin, then each laid-out page is relayed
 * through mupdf's PDF writer (real text stays selectable, unlike a raster
 * fallback). The layout call happens before pages are read; it changes the page
 * count, so it must precede the relay.
 */
export async function runEbookToPdf(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, fontSize, margins } = EbookToPdfInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await RichDocument.open(filePath, "ebook");
  try {
    doc.layout({ fontSize, margins });
    if (doc.pageCount === 0) {
      throw Object.assign(new Error(`Ebook lays out to no pages: ${filePath}`), {
        code: TOOL_ERROR_CODES.CORRUPT_PDF,
      });
    }

    const bytes = doc.relayToPdf((done, total) => {
      assertNotCancelled(ctx);
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / total) * 100),
        stage: "converting",
        pagesDone: done,
      });
    });

    const outPath = join(outDir, `${basename(filePath, extname(filePath))}.pdf`);
    await writeFile(outPath, bytes);
    return outPath;
  } finally {
    doc.close();
  }
}
