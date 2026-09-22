import sharp from "sharp";
import type { Pixmap } from "mupdf";
import { ScannerEffectInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { pixmapChannels, pixmapRaw, rebuildRasterPdf } from "./shared";

type Preset = "bw" | "gray" | "faded";

/**
 * Deterministic value noise for the grain pass: a cheap hash of the pixel
 * index, so the same input always produces the same output (unlike
 * Math.random) and no extra dependency is needed. The grain is small enough to
 * read as scanner noise without hiding content.
 */
function grainBytes(length: number): Int8Array {
  const out = new Int8Array(length);
  let seed = 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) | 0;
    out[i] = ((seed >>> 24) & 0xff) - 128;
  }
  return out;
}

async function applyPreset(pix: Pixmap, preset: Preset): Promise<Buffer> {
  const channels = pixmapChannels(pix);
  const width = pix.getWidth();
  const height = pix.getHeight();
  const raw = pixmapRaw(pix);

  // All three presets are greyscale scanners; convert first so the contrast
  // and threshold passes below operate on a single channel.
  let pipeline = sharp(raw, { raw: { width, height, channels } }).greyscale();
  if (preset === "gray") pipeline = pipeline.linear(1.4, -30);
  if (preset === "faded") pipeline = pipeline.linear(0.7, 60);

  const grey = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const data = Uint8Array.from(grey.data);

  if (preset === "bw") {
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) lut[v] = v < 128 ? 0 : 255;
    for (let i = 0; i < data.length; i++) data[i] = lut[data[i]];
  } else {
    const grain = grainBytes(data.length);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.max(0, Math.min(255, data[i] + grain[i]));
    }
  }

  return sharp(data, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

/** Applies a scanner-style preset to every page. */
export async function runScannerEffect(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, preset } = ScannerEffectInputSchema.parse(input);
  return rebuildRasterPdf(filePath, ctx, outDir, "scanned.pdf", "scanner-effect", {}, (pix) =>
    applyPreset(pix, preset as Preset)
  );
}
