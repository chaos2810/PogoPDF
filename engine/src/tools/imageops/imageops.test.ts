import { describe, it, expect, beforeAll, afterAll } from "vitest";
import sharp from "sharp";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Canvas } from "@napi-rs/canvas";
import {
  encryptedPdfBytes,
  fixtureDir,
  makePdf,
  makePdfWithRect,
  makeSkewedPdf,
} from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { loadMupdf } from "../../render/mupdfengine";
import { runDeskew, detectSkewAngle } from "./deskew";
import { runScannerEffect } from "./scanner";
import { runAdjustColors } from "./adjustcolors";
import { runInvertColors } from "./invertcolors";
import { runPosterize, posterizeLut } from "./posterize";
import { runBackgroundColor } from "./bgcolor";
import { runChangeTextColor } from "./textcolor";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

const scratch: string[] = [];
function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pogopdf-imageops-"));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function pixelAt(canvas: Canvas, x: number, y: number): number[] {
  const { data } = canvas.getContext("2d").getImageData(x, y, 1, 1);
  return [data[0], data[1], data[2], data[3]];
}

async function sample(path: string, x: number, y: number, dpi = 72): Promise<number[]> {
  const renderer = await getPdfRenderer(path);
  try {
    const canvas = await renderer.renderPage(0, dpi);
    // Scale the requested 72dpi coordinate to the render resolution.
    const sx = Math.round((x * dpi) / 72);
    const sy = Math.round((y * dpi) / 72);
    return pixelAt(canvas, sx, sy);
  } finally {
    await renderer.close();
  }
}

/** Runs the same projection-profile detector against a rendered output page. */
async function detectOn(path: string): Promise<number> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(readFileSync(path), "application/pdf");
  try {
    const page = doc.loadPage(0);
    try {
      const pm = page.toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceGray, false);
      try {
        return detectSkewAngle(Uint8Array.from(pm.getPixels()), pm.getWidth(), pm.getHeight());
      } finally {
        pm.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}

/**
 * Pixels from a central crop of a page rendered at 72dpi. Re-embedding a
 * raster and re-rendering softens region edges, so interior samples are the
 * only reliable way to assert a flat fill's value.
 */
async function interiorSamples(
  path: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Promise<number[][]> {
  const renderer = await getPdfRenderer(path);
  try {
    const canvas = await renderer.renderPage(0, 72);
    const ctx2d = canvas.getContext("2d");
    const out: number[][] = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const { data } = ctx2d.getImageData(x, y, 1, 1);
        out.push([data[0], data[1], data[2], data[3]]);
      }
    }
    return out;
  } finally {
    await renderer.close();
  }
}

describe("runDeskew", () => {
  let dir: string;

  beforeAll(() => {
    dir = fixtureDir("imageops-deskew");
  });

  it("straightens a synthetically 3deg-skewed page to within 0.5deg", async () => {
    const skewed = await makeSkewedPdf(join(dir, "skew-3.pdf"), 3);
    const out = await runDeskew({ filePath: skewed }, ctx, outDir());
    expect(out.endsWith("deskewed.pdf")).toBe(true);
    expect(Math.abs(await detectOn(out))).toBeLessThanOrEqual(0.5);
  });

  it("reports an upright page as a zero angle", async () => {
    const upright = await makePdf(join(dir, "upright.pdf"), 1);
    expect(Math.abs(await detectOn(upright))).toBeLessThanOrEqual(0.5);
    const out = await runDeskew({ filePath: upright }, ctx, outDir());
    expect(await detectOn(out)).toBe(0);
  });

  it("keeps the page count and displayed size", async () => {
    const skewed = await makeSkewedPdf(join(dir, "skew-3-size.pdf"), 3);
    const out = await runDeskew({ filePath: skewed }, ctx, outDir());
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(841.89, 1);
  });

  it("reports progress per page, ending at 100", async () => {
    const two = await makePdf(join(dir, "deskew-two.pdf"), 2);
    const events: number[] = [];
    await runDeskew(
      { filePath: two },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events[events.length - 1]).toBe(100);
  });

  it("throws CANCELLED when cancelled after the first page", async () => {
    const two = await makePdf(join(dir, "deskew-cancel.pdf"), 2);
    let cancelled = false;
    const cancelCtx = {
      ...ctx,
      cancelled: () => cancelled,
      notifyProgress: () => {
        cancelled = true;
      },
    };
    await expect(runDeskew({ filePath: two }, cancelCtx, outDir())).rejects.toMatchObject({
      code: -32005,
    });
  });
});

describe("runScannerEffect", () => {
  let dir: string;
  let red: string;

  beforeAll(async () => {
    dir = fixtureDir("imageops-scanner");
    red = await makePdfWithRect(join(dir, "red.pdf"), [{ rgb: [1, 0, 0], size: [100, 100] }]);
  });

  it("desaturates a color page to r≈g≈b with the default gray preset", async () => {
    const out = await runScannerEffect({ filePath: red }, ctx, outDir());
    const [r, g, b] = await sample(out, 100, 100);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
  });

  it("produces a different result for each preset", async () => {
    const values: number[] = [];
    for (const preset of ["bw", "gray", "faded"] as const) {
      const out = await runScannerEffect({ filePath: red, preset }, ctx, outDir());
      const [r] = await sample(out, 100, 100);
      values.push(r);
    }
    expect(new Set(values).size).toBe(3);
  });

  it("reports progress per page, ending at 100", async () => {
    const events: number[] = [];
    await runScannerEffect(
      { filePath: red },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events[events.length - 1]).toBe(100);
  });
});

describe("runAdjustColors", () => {
  let dir: string;
  let grey: string;

  beforeAll(async () => {
    dir = fixtureDir("imageops-adjust");
    grey = await makePdfWithRect(join(dir, "grey.pdf"), [{ rgb: [0.5, 0.5, 0.5], size: [100, 100] }]);
  });

  it("raises luma with a positive brightness", async () => {
    const before = await sample(grey, 100, 100);
    const out = await runAdjustColors({ filePath: grey, brightness: 40 }, ctx, outDir());
    const after = await sample(out, 100, 100);
    const luma = (p: number[]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    expect(luma(after)).toBeGreaterThan(luma(before) + 20);
  });

  it("lowers luma with a negative brightness", async () => {
    const before = await sample(grey, 100, 100);
    const out = await runAdjustColors({ filePath: grey, brightness: -40 }, ctx, outDir());
    const after = await sample(out, 100, 100);
    expect(after[0]).toBeLessThan(before[0] - 20);
  });

  it("reports progress per page, ending at 100", async () => {
    const events: number[] = [];
    await runAdjustColors(
      { filePath: grey, contrast: 20 },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events[events.length - 1]).toBe(100);
  });
});

describe("runInvertColors", () => {
  let dir: string;

  beforeAll(() => {
    dir = fixtureDir("imageops-invert");
  });

  it("turns a black square white and the white background black", async () => {
    const black = await makePdfWithRect(join(dir, "black.pdf"), [{ rgb: [0, 0, 0], size: [100, 100] }]);
    const out = await runInvertColors({ filePath: black }, ctx, outDir());
    const center = await sample(out, 100, 100);
    expect(center[0]).toBeGreaterThan(230);
    expect(center[1]).toBeGreaterThan(230);
    expect(center[2]).toBeGreaterThan(230);
    const corner = await sample(out, 5, 5);
    expect(corner[0]).toBeLessThan(30);
  });

  it("inverts each channel independently (red becomes cyan)", async () => {
    const red = await makePdfWithRect(join(dir, "red.pdf"), [{ rgb: [1, 0, 0], size: [100, 100] }]);
    const out = await runInvertColors({ filePath: red }, ctx, outDir());
    const [r, g, b] = await sample(out, 100, 100);
    expect(r).toBeLessThan(60);
    expect(g).toBeGreaterThan(200);
    expect(b).toBeGreaterThan(200);
  });

  it("reports progress per page, ending at 100", async () => {
    const two = await makePdf(join(dir, "invert-two.pdf"), 2);
    const events: number[] = [];
    await runInvertColors(
      { filePath: two },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events[events.length - 1]).toBe(100);
  });
});

describe("runPosterize", () => {
  let dir: string;
  let flat: string;

  beforeAll(async () => {
    dir = fixtureDir("imageops-posterize");
    flat = await makePdfWithRect(join(dir, "flat.pdf"), [{ rgb: [0.4, 0.4, 0.4], size: [100, 100] }]);
  });

  it("quantizes a flat color to a single level", async () => {
    const out = await runPosterize({ filePath: flat, levels: 4 }, ctx, outDir());
    // Interior pixels of the flat square are free of re-render edge blending.
    const samples = await interiorSamples(out, 70, 70, 130, 130);
    const values = new Set<number>();
    for (const [r, g, b] of samples) {
      expect(r).toBe(g);
      expect(g).toBe(b);
      values.add(r);
    }
    expect(values.size).toBe(1);
    expect([0, 85, 170, 255]).toContain([...values][0]);
  });

  it("honours the level count through the LUT", async () => {
    for (const levels of [2, 4, 8, 16, 32]) {
      const outputs = new Set(posterizeLut(levels));
      expect(outputs.size).toBeLessThanOrEqual(levels);
      expect(outputs.size).toBeGreaterThan(1);
    }
    expect(new Set(posterizeLut(8)).size).toBeGreaterThan(new Set(posterizeLut(4)).size);
  });

  it("reports progress per page, ending at 100", async () => {
    const events: number[] = [];
    await runPosterize(
      { filePath: flat, levels: 4 },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events[events.length - 1]).toBe(100);
  });
});

describe("runBackgroundColor", () => {
  let dir: string;

  beforeAll(() => {
    dir = fixtureDir("imageops-bgcolor");
  });

  it("repaints the page corners with the requested color", async () => {
    const text = await makePdf(join(dir, "bg-text.pdf"), 1);
    const out = await runBackgroundColor({ filePath: text, color: "#FF0000" }, ctx, outDir());
    const [r, g, b] = await sample(out, 5, 5);
    expect(r).toBeGreaterThan(240);
    expect(g).toBeLessThan(20);
    expect(b).toBeLessThan(20);
  });

  it("keeps the drawn content above the background", async () => {
    const black = await makePdfWithRect(join(dir, "bg-black-rect.pdf"), [
      { rgb: [0, 0, 0], size: [100, 100] },
    ]);
    const out = await runBackgroundColor({ filePath: black, color: "#00FF00" }, ctx, outDir());
    const center = await sample(out, 100, 100);
    expect(center[0]).toBeLessThan(30);
    const corner = await sample(out, 5, 5);
    expect(corner[1]).toBeGreaterThan(240);
  });

  it("reports progress per page, ending at 100", async () => {
    const two = await makePdf(join(dir, "bg-two.pdf"), 2);
    const events: number[] = [];
    await runBackgroundColor(
      { filePath: two, color: "#0000FF" },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events[events.length - 1]).toBe(100);
  });
});

describe("runChangeTextColor", () => {
  let dir: string;
  let text: string;

  beforeAll(async () => {
    dir = fixtureDir("imageops-textcolor");
    text = await makePdf(join(dir, "text.pdf"), 1);
  });

  it("tints black text pixels toward the target color", async () => {
    const out = await runChangeTextColor({ filePath: text, color: "#FF0000" }, ctx, outDir());
    const renderer = await getPdfRenderer(out);
    try {
      const canvas = await renderer.renderPage(0, 150);
      const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      let darkest = 255;
      let pixel = [0, 0, 0];
      for (let i = 0; i < data.length; i += 4) {
        const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (luma < darkest) {
          darkest = luma;
          pixel = [data[i], data[i + 1], data[i + 2]];
        }
      }
      expect(pixel[0]).toBeGreaterThan(200);
      expect(pixel[1]).toBeLessThan(80);
      expect(pixel[2]).toBeLessThan(80);
    } finally {
      await renderer.close();
    }
  });

  it("leaves the white background white", async () => {
    const out = await runChangeTextColor({ filePath: text, color: "#FF0000" }, ctx, outDir());
    const corner = await sample(out, 5, 5);
    expect(corner[0]).toBeGreaterThan(245);
    expect(corner[1]).toBeGreaterThan(245);
    expect(corner[2]).toBeGreaterThan(245);
  });

  it("reports progress per page, ending at 100", async () => {
    const events: number[] = [];
    await runChangeTextColor(
      { filePath: text, color: "#FF0000" },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events[events.length - 1]).toBe(100);
  });
});

describe("image-ops typed errors and cancellation", () => {
  let dir: string;
  let enc: string;

  beforeAll(() => {
    dir = fixtureDir("imageops-errors");
    enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF for every tool", async () => {
    const runs: Array<() => Promise<unknown>> = [
      () => runDeskew({ filePath: enc }, ctx, outDir()),
      () => runScannerEffect({ filePath: enc }, ctx, outDir()),
      () => runAdjustColors({ filePath: enc }, ctx, outDir()),
      () => runInvertColors({ filePath: enc }, ctx, outDir()),
      () => runPosterize({ filePath: enc }, ctx, outDir()),
      () => runBackgroundColor({ filePath: enc }, ctx, outDir()),
      () => runChangeTextColor({ filePath: enc }, ctx, outDir()),
    ];
    for (const run of runs) {
      await expect(run()).rejects.toMatchObject({ code: -32002 });
    }
  });

  it("flips the cancellation flag for every tool after the first page", async () => {
    const two = await makePdf(join(dir, "cancel-two.pdf"), 2);
    const cancelCtx = () => {
      let cancelled = false;
      return {
        cancelled: () => cancelled,
        notifyProgress: () => {
          cancelled = true;
        },
      };
    };
    const runs: Array<(c: ReturnType<typeof cancelCtx>) => Promise<unknown>> = [
      (c) => runScannerEffect({ filePath: two }, c, outDir()),
      (c) => runAdjustColors({ filePath: two }, c, outDir()),
      (c) => runInvertColors({ filePath: two }, c, outDir()),
      (c) => runPosterize({ filePath: two }, c, outDir()),
      (c) => runBackgroundColor({ filePath: two }, c, outDir()),
      (c) => runChangeTextColor({ filePath: two }, c, outDir()),
    ];
    for (const run of runs) {
      await expect(run(cancelCtx())).rejects.toMatchObject({ code: -32005 });
    }
  });
});

describe("scanner presets differ from one another", () => {
  it("bw produces only near-pure black and white in the interior", async () => {
    const dir = fixtureDir("imageops-scanner");
    const red = await makePdfWithRect(join(dir, "bw.pdf"), [{ rgb: [1, 0, 0], size: [100, 100] }]);
    const out = await runScannerEffect({ filePath: red, preset: "bw" }, ctx, outDir());
    // Sample the interior of the square and the outer margin, away from the
    // re-render's antialiased border.
    for (const [x0, y0, x1, y1] of [[70, 70, 130, 130], [5, 5, 40, 40]] as const) {
      for (const [r] of await interiorSamples(out, x0, y0, x1, y1)) {
        expect(r <= 16 || r >= 239).toBe(true);
      }
    }
  });
});

describe("image-ops build green check", () => {
  it("exports a callable run function for each tool", () => {
    for (const fn of [
      runDeskew,
      runScannerEffect,
      runAdjustColors,
      runInvertColors,
      runPosterize,
      runBackgroundColor,
      runChangeTextColor,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });
});
