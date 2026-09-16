import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Canvas } from "@napi-rs/canvas";
import {
  encryptedPdfBytes,
  fixtureDir,
  makePdf,
  makePdfWithEmbeddedJpg,
  makePdfWithEmbeddedPng,
  makePdfWithRect,
} from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { encodeCanvas } from "../../render/encode";
import { runPdfToImages } from "./pdftoimages";
import { runPdfToText } from "./pdftotext";
import { runPdfToGreyscale } from "./pdftogreyscale";
import { runExtractImages } from "./extractimages";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-test-"));
}

function startsWith(buf: Buffer, bytes: number[]): boolean {
  return bytes.every((b, i) => buf[i] === b);
}

function pixelAt(canvas: Canvas, x: number, y: number): number[] {
  const { data } = canvas.getContext("2d").getImageData(x, y, 1, 1);
  return [data[0], data[1], data[2], data[3]];
}

describe("runPdfToImages", () => {
  let dir: string;
  let two: string;

  beforeAll(async () => {
    dir = fixtureDir("convertout-raster");
    two = await makePdf(join(dir, "two.pdf"), 2);
  });

  it("writes one basename-{n}.ext per page (png)", async () => {
    const out = await runPdfToImages({ filePath: two, format: "png" }, ctx, outDir());
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(2);
    expect(out[0].endsWith("two-1.png")).toBe(true);
    expect(out[1].endsWith("two-2.png")).toBe(true);
    for (const p of out) {
      const buf = readFileSync(p);
      expect(startsWith(buf, [0x89, 0x50, 0x4e, 0x47])).toBe(true);
      const meta = await sharp(buf).metadata();
      expect(meta.width).toBe(1240);
      expect(meta.height).toBe(1753);
    }
  });

  it("writes jpg magic bytes and honours the quality default (80)", async () => {
    const dirOut = outDir();
    const out = await runPdfToImages({ filePath: two, format: "jpg" }, ctx, dirOut);
    const buf = readFileSync(out[0]);
    expect(startsWith(buf, [0xff, 0xd8])).toBe(true);

    const renderer = await getPdfRenderer(two);
    try {
      const canvas = await renderer.renderPage(0, 150);
      const expected = await encodeCanvas(canvas, "jpg", 80);
      expect(buf.equals(expected)).toBe(true);
    } finally {
      await renderer.close();
    }
  });

  it("honours an explicit quality for jpg", async () => {
    const low = await runPdfToImages(
      { filePath: two, format: "jpg", quality: 10 },
      ctx,
      outDir()
    );
    const high = await runPdfToImages(
      { filePath: two, format: "jpg", quality: 95 },
      ctx,
      outDir()
    );
    expect(readFileSync(high[0]).length).toBeGreaterThan(readFileSync(low[0]).length);
  });

  it("renders only the selected pages, named by position in the selection", async () => {
    const out = await runPdfToImages({ filePath: two, format: "png", pages: "2" }, ctx, outDir());
    expect(out).toHaveLength(1);
    expect(out[0].endsWith("two-1.png")).toBe(true);
  });

  it("reports progress per page, ending at 100", async () => {
    const events: number[] = [];
    await runPdfToImages(
      { filePath: two, format: "png" },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events.length).toBe(2);
    expect(events[events.length - 1]).toBe(100);
  });

  it("throws CANCELLED when cancelled after the first page", async () => {
    let cancelled = false;
    const cancelCtx = {
      ...ctx,
      cancelled: () => cancelled,
      notifyProgress: () => {
        cancelled = true;
      },
    };
    await expect(
      runPdfToImages({ filePath: two, format: "png" }, cancelCtx, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("runPdfToText", () => {
  let dir: string;
  let two: string;

  beforeAll(async () => {
    dir = fixtureDir("convertout-raster");
    two = await makePdf(join(dir, "text-two.pdf"), 2);
  });

  it("writes basename.txt with form-feed page breaks", async () => {
    const out = await runPdfToText({ filePath: two }, ctx, outDir());
    expect(out.endsWith("text-two.txt")).toBe(true);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("Page 1");
    expect(text).toContain("Page 2");
    expect(text.split("\f")).toHaveLength(2);
  });

  it("extracts only the selected pages", async () => {
    const out = await runPdfToText({ filePath: two, pages: "2" }, ctx, outDir());
    const text = readFileSync(out, "utf8");
    expect(text).toContain("Page 2");
    expect(text).not.toContain("Page 1");
  });

  it("reports progress per page, ending at 100", async () => {
    const events: number[] = [];
    await runPdfToText(
      { filePath: two },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events[events.length - 1]).toBe(100);
  });

  it("throws CANCELLED when cancelled after the first page", async () => {
    let cancelled = false;
    const cancelCtx = {
      ...ctx,
      cancelled: () => cancelled,
      notifyProgress: () => {
        cancelled = true;
      },
    };
    await expect(runPdfToText({ filePath: two }, cancelCtx, outDir())).rejects.toMatchObject({
      code: -32005,
    });
  });
});

describe("runPdfToGreyscale", () => {
  let dir: string;
  let redSquare: string;

  beforeAll(async () => {
    dir = fixtureDir("convertout-raster");
    redSquare = await makePdfWithRect(join(dir, "red-square.pdf"), [
      { rgb: [1, 0, 0], size: [100, 100] },
    ]);
  });

  it("desaturates page pixels to r≈g≈b end-to-end", async () => {
    // Sanity: the source square really is red.
    const srcRenderer = await getPdfRenderer(redSquare);
    try {
      const src = await srcRenderer.renderPage(0, 72);
      const [r, g, b] = pixelAt(src, 100, 100);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeLessThan(60);
      expect(b).toBeLessThan(60);
    } finally {
      await srcRenderer.close();
    }

    const out = await runPdfToGreyscale({ filePath: redSquare }, ctx, outDir());
    expect(out.endsWith("greyscale.pdf")).toBe(true);
    const doc = await PDFDocument.load(await readFile(out));
    expect(doc.getPageCount()).toBe(1);

    const renderer = await getPdfRenderer(out);
    try {
      const canvas = await renderer.renderPage(0, 72);
      const [r, g, b] = pixelAt(canvas, 100, 100);
      expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
      expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
      expect(r).toBeLessThan(120);
    } finally {
      await renderer.close();
    }
  });

  it("re-embeds a rotated page at its rendered (display) dimensions", async () => {
    const rotated = await makePdf(join(dir, "rotated.pdf"), 1, {
      sizes: [[200, 100]],
      rotations: [90],
    });
    const out = await runPdfToGreyscale({ filePath: rotated }, ctx, outDir());
    const doc = await PDFDocument.load(await readFile(out));
    const { width, height } = doc.getPage(0).getSize();
    // A 200x100 page with /Rotate 90 displays as 100x200.
    expect(width).toBe(100);
    expect(height).toBe(200);
    expect(doc.getPage(0).getRotation().angle).toBe(0);
  });

  it("reports progress per page, ending at 100", async () => {
    const events: number[] = [];
    await runPdfToGreyscale(
      { filePath: redSquare },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events[events.length - 1]).toBe(100);
  });

  it("throws CANCELLED when cancelled after the first page", async () => {
    const two = await makePdf(join(dir, "grey-two.pdf"), 2);
    let cancelled = false;
    const cancelCtx = {
      ...ctx,
      cancelled: () => cancelled,
      notifyProgress: () => {
        cancelled = true;
      },
    };
    await expect(runPdfToGreyscale({ filePath: two }, cancelCtx, outDir())).rejects.toMatchObject({
      code: -32005,
    });
  });
});

describe("runExtractImages", () => {
  let dir: string;
  let embedded: string;

  beforeAll(async () => {
    dir = fixtureDir("convertout-raster");
    embedded = await makePdfWithEmbeddedJpg(join(dir, "embedded.pdf"), [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 0, b: 255 },
    ]);
  });

  it("passes through embedded JPEG streams as image-{n}.jpg", async () => {
    const out = await runExtractImages({ filePath: embedded }, ctx, outDir());
    expect(out).toHaveLength(2);
    expect(out[0].endsWith("image-1.jpg")).toBe(true);
    expect(out[1].endsWith("image-2.jpg")).toBe(true);
    for (const p of out) {
      expect(existsSync(p)).toBe(true);
      expect(startsWith(readFileSync(p), [0xff, 0xd8])).toBe(true);
    }
  });

  it("throws UNSUPPORTED_FORMAT for a file with no JPEG/JP2 images", async () => {
    const plain = await makePdf(join(dir, "no-images.pdf"), 1);
    await expect(runExtractImages({ filePath: plain }, ctx, outDir())).rejects.toMatchObject({
      code: -32006,
    });
  });

  it("skips FlateDecode (PNG) image streams in v1", async () => {
    const png = await makePdfWithEmbeddedPng(join(dir, "png-images.pdf"), [
      { r: 0, g: 255, b: 0 },
    ]);
    await expect(runExtractImages({ filePath: png }, ctx, outDir())).rejects.toMatchObject({
      code: -32006,
    });
  });
});

describe("raster typed errors", () => {
  it("maps an encrypted PDF to ENCRYPTED_PDF through the renderer", async () => {
    const dir = fixtureDir("convertout-raster");
    const enc = join(dir, "encrypted.pdf");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runPdfToImages({ filePath: enc, format: "png" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
    await expect(runPdfToText({ filePath: enc }, ctx, outDir())).rejects.toMatchObject({
      code: -32002,
    });
    await expect(runPdfToGreyscale({ filePath: enc }, ctx, outDir())).rejects.toMatchObject({
      code: -32002,
    });
    await expect(runExtractImages({ filePath: enc }, ctx, outDir())).rejects.toMatchObject({
      code: -32002,
    });
  });

  it("maps unreadable bytes to CORRUPT_PDF", async () => {
    const garbage = join(fixtureDir("convertout-raster"), "garbage.pdf");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(garbage, Buffer.from("not a pdf at all"));
    await expect(
      runPdfToImages({ filePath: garbage, format: "png" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003 });
  });
});
