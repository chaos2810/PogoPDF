import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import sharp from "sharp";
import type { Metadata } from "sharp";
import { createCanvas, loadImage as loadCanvasImage } from "@napi-rs/canvas";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";

/** The two containers pdf-lib can embed without re-encoding. */
export type ImageKind = "jpg" | "png";

export type EmbeddableImage = {
  bytes: Uint8Array;
  kind: ImageKind;
  widthPx: number;
  heightPx: number;
};

/** Input containers v1 understands, by extension (`.jpe`/`.tif` etc. included). */
export type InputImageFormat =
  | "jpg"
  | "png"
  | "webp"
  | "tiff"
  | "gif"
  | "svg"
  | "bmp"
  | "heic";

const EXTENSION_FORMAT: Record<string, InputImageFormat> = {
  jpg: "jpg",
  jpeg: "jpg",
  jpe: "jpg",
  jfif: "jpg",
  png: "png",
  webp: "webp",
  tif: "tiff",
  tiff: "tiff",
  gif: "gif",
  svg: "svg",
  svgz: "svg",
  bmp: "bmp",
  heic: "heic",
  heif: "heic",
};

/**
 * Formats transcoded to PNG through sharp (the prebuilt libvips reads all of
 * these). `heic` is handled separately because the same binary ships libheif
 * without an HEVC decoder.
 */
const SHARP_TRANSCODE: ReadonlySet<InputImageFormat> = new Set([
  "webp",
  "tiff",
  "gif",
  "svg",
]);

function corrupt(message: string): Error {
  return Object.assign(new Error(message), { code: TOOL_ERROR_CODES.CORRUPT_PDF });
}

function unsupported(message: string): Error {
  return Object.assign(new Error(message), { code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT });
}

function ascii(bytes: Buffer, start: number, length: number): string {
  return bytes.toString("latin1", start, start + length);
}

/**
 * Content sniffing for files whose extension is absent or wrong. Mirrors the
 * formats the extension table knows; BMP and HEIC have unambiguous signatures.
 */
export function sniffImageFormat(bytes: Buffer): InputImageFormat | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  const head = ascii(bytes, 0, 6);
  if (head === "GIF87a" || head === "GIF89a") return "gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "webp";
  }
  if (bytes.length >= 4) {
    const tiffLE = ascii(bytes, 0, 2) === "II" && bytes[2] === 0x2a && bytes[3] === 0x00;
    const tiffBE = ascii(bytes, 0, 2) === "MM" && bytes[2] === 0x00 && bytes[3] === 0x2a;
    if (tiffLE || tiffBE) return "tiff";
  }
  if (ascii(bytes, 0, 2) === "BM") return "bmp";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "heic" || brand === "heix" || brand === "hevc" || brand === "hevx") {
      return "heic";
    }
  }
  const text = bytes.toString("utf8", 0, 512).trimStart();
  if (/^<svg[\s>]/i.test(text) || (/^<\?xml/i.test(text) && /<svg[\s>]/i.test(text))) {
    return "svg";
  }
  return undefined;
}

/** Pixel dimensions for a supported container, with the animated-frame guard. */
function dimsFrom(meta: Metadata): { widthPx: number; heightPx: number } {
  if (!meta.width || !meta.height) {
    throw corrupt("Image has no intrinsic dimensions");
  }
  // Multi-frame images report the stacked height; the per-frame height is the
  // page size sharp will actually read (first frame) without `animated: true`.
  const heightPx = meta.pageHeight ?? meta.height;
  return { widthPx: meta.width, heightPx };
}

async function passthrough(
  path: string,
  kind: ImageKind,
  bytes: Buffer
): Promise<EmbeddableImage> {
  let meta: Metadata;
  try {
    // metadata() only parses the header, so jpg/png bytes stay untouched. It
    // still rejects a truncated JPEG body ("premature end of JPEG image").
    meta = await sharp(path).metadata();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw corrupt(`Cannot read ${path}: ${msg}`);
  }
  const dims = dimsFrom(meta);

  if (kind === "png") {
    // A PNG with a valid header but corrupt/truncated deflate data passes
    // metadata(), then spins forever inside pdf-lib's pure-JS PNG decoder
    // (@pdf-lib/upng) instead of throwing. Force a real decode here so the
    // failure is a fast typed error. `resize` keeps the output tiny while sharp
    // still decodes the whole image; the buffer is freed before the caller
    // embeds the original bytes.
    try {
      await sharp(bytes).resize(1, 1, { fit: "fill" }).raw().toBuffer();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw corrupt(`Cannot decode png image ${path}: ${msg}`);
    }
  }

  return { bytes, kind, ...dims };
}

/** A typed tool error (already carries a TOOL_ERROR_CODES value). */
function hasToolCode(e: unknown): boolean {
  return typeof (e as { code?: unknown })?.code === "number";
}

async function transcodeSharp(path: string, format: InputImageFormat): Promise<EmbeddableImage> {
  try {
    const meta = await sharp(path).metadata();
    const dims = dimsFrom(meta);
    const png = await sharp(path).png().toBuffer();
    return { bytes: png, kind: "png", ...dims };
  } catch (e) {
    if (hasToolCode(e)) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw corrupt(`Cannot decode ${format} image ${path}: ${msg}`);
  }
}

/**
 * BMP: every prebuilt sharp 0.35 libvips on npm is built without a BMP reader
 * ("Input file contains unsupported image format"), so fall back to
 * @napi-rs/canvas, which reads 24-bit BMP reliably.
 */
async function transcodeBmp(path: string): Promise<EmbeddableImage> {
  try {
    const image = await loadCanvasImage(path);
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image, 0, 0);
    return {
      bytes: canvas.toBuffer("image/png"),
      kind: "png",
      widthPx: image.width,
      heightPx: image.height,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw corrupt(`Cannot decode bmp image ${path}: ${msg}`);
  }
}

/**
 * HEIC/HEIF: probe sharp at runtime. Metadata usually parses (libheif reads the
 * container) while the pixel decode fails when the build lacks the codec — that
 * is a missing-codec condition, not a corrupt file, so it maps to
 * UNSUPPORTED_FORMAT. AV1-in-HEIF (the AVIF container family) does decode.
 */
async function transcodeHeic(path: string): Promise<EmbeddableImage> {
  let meta: Metadata;
  try {
    meta = await sharp(path).metadata();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw corrupt(`Cannot read ${path}: ${msg}`);
  }
  const dims = dimsFrom(meta);
  try {
    const png = await sharp(path).png().toBuffer();
    return { bytes: png, kind: "png", ...dims };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw unsupported(
      `HEIC is not supported in this build (no HEVC decoder in the bundled libvips): ${msg}`
    );
  }
}

/**
 * Load any supported image file as bytes pdf-lib can embed.
 *
 * Supported (verified against the bundled sharp 0.35.4 / libvips 8.18.6):
 * - jpg/jpeg: passthrough, kind "jpg" (embedJpg)
 * - png: passthrough, kind "png" (embedPng)
 * - webp, tiff/tif, gif, svg: transcoded to PNG through sharp
 * - bmp: transcoded to PNG through @napi-rs/canvas (libvips has no BMP reader)
 * - heic/heif: probed; HEVC fails in this build (typed UNSUPPORTED_FORMAT)
 *
 * Extension decides first, content sniffing is the fallback; anything else
 * (psd, avif, …) is rejected as UNSUPPORTED_FORMAT. Unreadable or corrupt
 * bytes for a supported container map to CORRUPT_PDF, as does a missing file.
 */
export async function loadImageEmbeddable(path: string): Promise<EmbeddableImage> {
  if (!existsSync(path)) {
    throw corrupt(`File not found: ${path}`);
  }

  const ext = extname(path).slice(1).toLowerCase();
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw corrupt(`Cannot read ${path}: ${msg}`);
  }

  // Extension decides; content wins only when it conclusively contradicts the
  // name. Handing PNG bytes to pdf-lib's embedJpg throws an untyped error, and
  // mislabelled extensions are common (e.g. camera HEIC saved as .jpg).
  const extFormat = EXTENSION_FORMAT[ext];
  const sniffed = sniffImageFormat(bytes);
  const format = extFormat && sniffed && sniffed !== extFormat ? sniffed : extFormat ?? sniffed;

  switch (format) {
    case "jpg":
      return passthrough(path, "jpg", bytes);
    case "png":
      return passthrough(path, "png", bytes);
    case "bmp":
      return transcodeBmp(path);
    case "heic":
      return transcodeHeic(path);
    default:
      if (format && SHARP_TRANSCODE.has(format)) {
        return transcodeSharp(path, format);
      }
      throw unsupported(`Unsupported image format: ${ext || sniffed || "unknown"}`);
  }
}
