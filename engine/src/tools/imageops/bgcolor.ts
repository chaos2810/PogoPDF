import sharp from "sharp";
import type { Pixmap } from "mupdf";
import { BackgroundColorInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { pixmapChannels, pixmapRaw, rebuildRasterPdf } from "./shared";

/**
 * Repaint the page background. PDF pages carry no background of their own (the
 * viewer paints white), so the page is rendered with alpha and then flattened
 * onto the requested color: transparent areas take the color, drawn content
 * stays above it.
 */
async function fillBackground(pix: Pixmap, color: string): Promise<Buffer> {
  const width = pix.getWidth();
  const height = pix.getHeight();
  const channels = pixmapChannels(pix);
  return sharp(pixmapRaw(pix), { raw: { width, height, channels } })
    .flatten({ background: color })
    .png()
    .toBuffer();
}

export async function runBackgroundColor(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, color } = BackgroundColorInputSchema.parse(input);
  return rebuildRasterPdf(
    filePath,
    ctx,
    outDir,
    "background.pdf",
    "filling-background",
    { alpha: true },
    (pix) => fillBackground(pix, color)
  );
}
