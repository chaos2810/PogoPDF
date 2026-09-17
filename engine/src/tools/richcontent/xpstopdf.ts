import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { XpsToPdfInputSchema, TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { RichDocument } from "../../render/mupdfengine";
import { assertNotCancelled } from "../organize/organize";

/**
 * XPS/OXPS -> PDF. XPS is a fixed-layout format, so there is no reflow to
 * configure; every page is relayed through mupdf's PDF writer at its own
 * MediaBox.
 *
 * IMPORTANT (verified against mupdf 1.28.1): the official MuPDF.js wasm build
 * compiles the XPS module out (platform/wasm/build.sh passes `xps=no`), so this
 * build cannot open XPS and reports typed UNSUPPORTED_FORMAT naming the format.
 * The full mupdf library (and PyMuPDF) does support XPS; enabling it requires a
 * custom wasm build, which is a release-packing decision, not a tool change.
 */
export async function runXpsToPdf(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath } = XpsToPdfInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await RichDocument.open(filePath, "xps");
  try {
    if (doc.pageCount === 0) {
      throw Object.assign(new Error(`XPS document has no pages: ${filePath}`), {
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
