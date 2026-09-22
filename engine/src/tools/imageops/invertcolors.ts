import type { Pixmap } from "mupdf";
import { InvertColorsInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { rebuildRasterPdf } from "./shared";

/**
 * Invert colors page by page. mupdf's own pixmap API is used here rather than
 * sharp: `Pixmap.invert()` flips every channel, which is what "invert colors"
 * means. (The plan's original wording said `invertLuminance()`, but probing
 * mupdf 1.28.1 shows that maps a pixel onto its luma complement, not a true
 * RGB invert; `invert()` is the correct primitive.)
 */
async function invertPixmap(pix: Pixmap): Promise<Buffer> {
  pix.invert();
  return Buffer.from(pix.asPNG());
}

export async function runInvertColors(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath } = InvertColorsInputSchema.parse(input);
  return rebuildRasterPdf(filePath, ctx, outDir, "inverted.pdf", "inverting", {}, invertPixmap);
}
