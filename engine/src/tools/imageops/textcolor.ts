import sharp from "sharp";
import type { Pixmap } from "mupdf";
import { ChangeTextColorInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { pixmapChannels, pixmapRaw, rebuildRasterPdf } from "./shared";

/** Luma at or below this is treated as fully "text"; above it, fully untouched. */
const DARK_THRESHOLD = 200;

type Rgb = { r: number; g: number; b: number };

function parseHex(color: string): Rgb {
  return {
    r: parseInt(color.slice(1, 3), 16),
    g: parseInt(color.slice(3, 5), 16),
    b: parseInt(color.slice(5, 7), 16),
  };
}

/**
 * Approximate text recolor. The raster path cannot tell glyph pixels apart from
 * dark graphics, so this tints progressively darker pixels toward the target
 * color: a pixel at full black becomes the target color, mid-tones blend, and
 * light background is left alone. It recolors dark graphics too, which the UI
 * hint states honestly.
 */
async function recolorDarkPixels(pix: Pixmap, target: Rgb): Promise<Buffer> {
  const channels = pixmapChannels(pix);
  const width = pix.getWidth();
  const height = pix.getHeight();
  const data = Uint8Array.from(pixmapRaw(pix));

  for (let i = 0; i < data.length; i += channels) {
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const t = Math.max(0, Math.min(1, (DARK_THRESHOLD - luma) / DARK_THRESHOLD));
    if (t === 0) continue;
    data[i] = Math.round(255 * (1 - t) + target.r * t);
    data[i + 1] = Math.round(255 * (1 - t) + target.g * t);
    data[i + 2] = Math.round(255 * (1 - t) + target.b * t);
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

export async function runChangeTextColor(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, color } = ChangeTextColorInputSchema.parse(input);
  const target = parseHex(color);
  return rebuildRasterPdf(
    filePath,
    ctx,
    outDir,
    "text-color.pdf",
    "recoloring-text",
    {},
    (pix) => recolorDarkPixels(pix, target)
  );
}
