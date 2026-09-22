import sharp from "sharp";
import type { Pixmap } from "mupdf";
import { PosterizeInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { pixmapChannels, pixmapRaw, rebuildRasterPdf } from "./shared";

/**
 * Build the per-channel quantization table: each input value maps to the
 * nearest of `levels` evenly spaced output steps, giving at most `levels`
 * distinct values per channel.
 */
export function posterizeLut(levels: number): Uint8Array {
  const step = 255 / (levels - 1);
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.max(0, Math.min(255, Math.round(Math.round(v / step) * step)));
  }
  return lut;
}

async function posterize(pix: Pixmap, levels: number): Promise<Buffer> {
  const channels = pixmapChannels(pix);
  const width = pix.getWidth();
  const height = pix.getHeight();
  const data = Uint8Array.from(pixmapRaw(pix));
  const lut = posterizeLut(levels);
  for (let i = 0; i < data.length; i++) data[i] = lut[data[i]];
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

/** Quantizes every page's raster to `levels` steps per channel. */
export async function runPosterize(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, levels } = PosterizeInputSchema.parse(input);
  return rebuildRasterPdf(filePath, ctx, outDir, "posterized.pdf", "posterizing", {}, (pix) =>
    posterize(pix, levels)
  );
}
