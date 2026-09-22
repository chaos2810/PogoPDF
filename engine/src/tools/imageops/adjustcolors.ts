import sharp from "sharp";
import type { Pixmap } from "mupdf";
import { AdjustColorsInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { pixmapChannels, pixmapRaw, rebuildRasterPdf } from "./shared";

type Knobs = { brightness: number; contrast: number; saturation: number; gamma: number };

/**
 * Gamma correction as a 256-entry LUT: `out = 255 * (v/255)^(1/gamma)`. sharp's
 * own gamma() only accepts 1.0..3.0, but the schema allows down to 0.1, so the
 * transform is applied here over the raw channel values instead.
 */
function gammaLut(gamma: number): Uint8Array {
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.max(0, Math.min(255, Math.round(255 * Math.pow(v / 255, 1 / gamma))));
  }
  return lut;
}

async function adjust(pix: Pixmap, knobs: Knobs): Promise<Buffer> {
  const channels = pixmapChannels(pix);
  const width = pix.getWidth();
  const height = pix.getHeight();
  const raw = pixmapRaw(pix);

  // brightness is a straight offset; contrast pivots around mid grey. sharp
  // keeps only the last .linear() in a pipeline, so the two affine steps are
  // composed into one: y = contrastScale*x + (contrastScale*offset + pivot).
  const brightnessOffset = (knobs.brightness / 100) * 255;
  const contrastScale = 1 + knobs.contrast / 100;
  const contrastOffset = 128 * (1 - contrastScale);
  const scale = contrastScale;
  const offset = contrastScale * brightnessOffset + contrastOffset;
  const saturation = 1 + knobs.saturation / 100;

  const grey = await sharp(raw, { raw: { width, height, channels } })
    .linear(scale, offset)
    .modulate({ saturation })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const data = Uint8Array.from(grey.data);
  if (knobs.gamma !== 1) {
    const lut = gammaLut(knobs.gamma);
    for (let i = 0; i < data.length; i++) data[i] = lut[data[i]];
  }

  return sharp(data, { raw: { width, height, channels: grey.info.channels } })
    .png()
    .toBuffer();
}

/** Applies brightness/contrast/saturation/gamma to every page. */
export async function runAdjustColors(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, brightness, contrast, saturation, gamma } =
    AdjustColorsInputSchema.parse(input);
  return rebuildRasterPdf(filePath, ctx, outDir, "adjusted.pdf", "adjusting-colors", {}, (pix) =>
    adjust(pix, { brightness, contrast, saturation, gamma })
  );
}
