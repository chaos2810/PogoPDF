import sharp from "sharp";
import type { Canvas } from "@napi-rs/canvas";

export type OutputImageFormat = "jpg" | "png" | "webp" | "tiff" | "bmp";

const DEFAULT_QUALITY = 80;

/**
 * BMP is the one format neither sharp nor @napi-rs/canvas can encode
 * (`sharp.toFormat("bmp")` throws; canvas `toBuffer("image/bmp")` is not a
 * valid mime), so it is written by hand below as a 24-bit uncompressed
 * BITMAPINFOHEADER file from sharp's raw RGBA pixels.
 */
async function encodeBmp(canvas: Canvas): Promise<Buffer> {
  const { data, info } = await sharp(canvas.data(), {
    raw: { width: canvas.width, height: canvas.height, channels: 4 },
  })
    .flatten({ background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const pixelOffset = 14 + 40;
  const out = Buffer.alloc(pixelOffset + rowBytes * height);

  out.write("BM", 0, "ascii");
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(pixelOffset, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(rowBytes * height, 34);

  // BMP rows are stored bottom-up with BGR triples and 4-byte row padding.
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 3;
    const dst = pixelOffset + y * rowBytes;
    for (let x = 0; x < width; x++) {
      const s = src + x * 3;
      const d = dst + x * 3;
      out[d] = data[s + 2];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s];
    }
  }
  return out;
}

export async function encodeCanvas(
  canvas: Canvas,
  format: OutputImageFormat,
  quality?: number
): Promise<Buffer> {
  if (format === "bmp") return encodeBmp(canvas);

  const q = quality ?? DEFAULT_QUALITY;
  const pipeline = sharp(canvas.data(), {
    raw: { width: canvas.width, height: canvas.height, channels: 4 },
  });

  switch (format) {
    case "jpg":
      return pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: q }).toBuffer();
    case "png":
      return pipeline.png().toBuffer();
    case "webp":
      return pipeline.webp({ quality: q }).toBuffer();
    case "tiff":
      return pipeline.tiff().toBuffer();
  }
}
