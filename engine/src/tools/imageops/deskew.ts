import sharp from "sharp";
import type { Pixmap } from "mupdf";
import { DeskewInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { rebuildRasterPdf, openMupdfPdf } from "./shared";

/** Detection runs on a 72dpi grayscale raster: small, but enough for text rows. */
const DETECT_DPI = 72;
/** Candidate skew angles, in degrees; 0.5 steps cover ordinary scan skew. */
const MIN_ANGLE = -7.5;
const MAX_ANGLE = 7.5;
const ANGLE_STEP = 0.5;

/**
 * Bilinear-free (nearest) rotation of a single-channel raster by `degrees`
 * about the image centre; out-of-bounds samples read as white. Pure JS so the
 * detector has no image dependency.
 */
function rotateGray(
  src: Uint8Array,
  width: number,
  height: number,
  degrees: number
): Uint8Array {
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const cx = width / 2;
  const cy = height / 2;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const sx = Math.round(cx + dx * cos - dy * sin);
      const sy = Math.round(cy + dx * sin + dy * cos);
      out[y * width + x] =
        sx >= 0 && sx < width && sy >= 0 && sy < height ? src[sy * width + sx] : 255;
    }
  }
  return out;
}

/**
 * Variance of the per-row ink sum. Text rows align when the page is upright,
 * so the angle that maximizes this measure is the deskew angle.
 */
function rowInkVariance(gray: Uint8Array, width: number, height: number): number {
  const rows = new Float64Array(height);
  let total = 0;
  for (let y = 0; y < height; y++) {
    let ink = 0;
    const base = y * width;
    for (let x = 0; x < width; x++) ink += 255 - gray[base + x];
    rows[y] = ink;
    total += ink;
  }
  const mean = total / height;
  let variance = 0;
  for (let y = 0; y < height; y++) {
    const d = rows[y] - mean;
    variance += d * d;
  }
  return variance / height;
}

/**
 * Projection-profile skew detection: search candidate angles, rotating the
 * raster by each and picking the one with the highest row-ink variance. The
 * baseline is 0 so a blank or already-upright page reports 0 rather than the
 * first candidate.
 */
export function detectSkewAngle(
  gray: Uint8Array,
  width: number,
  height: number
): number {
  let best = 0;
  let bestScore = rowInkVariance(gray, width, height);
  for (let angle = MIN_ANGLE; angle <= MAX_ANGLE + 1e-9; angle += ANGLE_STEP) {
    if (angle === 0) continue;
    const score = rowInkVariance(rotateGray(gray, width, height, angle), width, height);
    if (score > bestScore) {
      bestScore = score;
      best = angle;
    }
  }
  return best;
}

/** Render page 1 as a grayscale raster and detect its skew angle. */
async function detectPageSkew(filePath: string): Promise<number> {
  const { mupdf, doc } = await openMupdfPdf(filePath);
  try {
    const page = doc.loadPage(0);
    try {
      const scale = DETECT_DPI / 72;
      const pix = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceGray,
        false
      );
      try {
        return detectSkewAngle(Uint8Array.from(pix.getPixels()), pix.getWidth(), pix.getHeight());
      } finally {
        pix.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}

/** Rotate a pixmap's PNG bytes by `angle` degrees without changing its size. */
async function rotatePixmap(pix: Pixmap, angle: number): Promise<Buffer> {
  const png = Buffer.from(pix.asPNG());
  const width = pix.getWidth();
  const height = pix.getHeight();
  return sharp(png)
    .rotate(angle, { background: "#ffffff" })
    .resize(width, height, { fit: "contain", background: "#ffffff" })
    .png()
    .toBuffer();
}

/**
 * Deskew a scan: detect the skew from page 1's grayscale raster, then rebuild
 * every page as a 150dpi image counter-rotated by that angle. Counter-rotation
 * is `-angle` because the detector reports the page's existing tilt.
 */
export async function runDeskew(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath } = DeskewInputSchema.parse(input);
  const angle = await detectPageSkew(filePath);
  const correction = angle === 0 ? 0 : -angle;
  return rebuildRasterPdf(filePath, ctx, outDir, "deskewed.pdf", "deskewing", {}, (pix) =>
    rotatePixmap(pix, correction)
  );
}
