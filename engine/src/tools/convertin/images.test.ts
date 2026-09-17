import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from "pdf-lib";
import { fixtureDir } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { loadImageEmbeddable } from "../../render/decode";
import { registerTools } from "../registry";
import { runImagesToPdf } from "./imagestopdf";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-test-"));
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b);

/** 24-bit uncompressed BMP (sharp's prebuilt libvips has no BMP reader). */
function makeBmp(path: string, w: number, h: number, r: number, g: number, b: number): string {
  const rowBytes = Math.ceil((w * 3) / 4) * 4;
  const off = 54;
  const out = Buffer.alloc(off + rowBytes * h);
  out.write("BM", 0, "ascii");
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(off, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = off + y * rowBytes + x * 3;
      out[d] = b;
      out[d + 1] = g;
      out[d + 2] = r;
    }
  }
  writeFileSync(path, out);
  return path;
}

async function solid(
  path: string,
  format: "jpeg" | "png" | "webp" | "tiff" | "gif",
  w: number,
  h: number,
  colour: { r: number; g: number; b: number }
): Promise<string> {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: colour },
  })
    .toFormat(format)
    .toBuffer();
  writeFileSync(path, buf);
  return path;
}

// A real HEVC-coded HEIC (libheif conformance_window_padding.heic, 1x1). The
// prebuilt libvips in sharp 0.35 has libheif without an HEVC decoder, so this
// exercises the honest unsupported path in this build.
const HEIC_BASE64 =
  "AAAAGGZ0eXBoZWljAAAAAGhlaWNtaWYxAAAB4G1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAABA2lwcnAAAADiaXBjbwAAABNjb2xybmNseAACAAIABoAAAAAUaXNwZQAAAAAAAAACAAAAAgAAAChjbGFwAAAAAQAAAAEAAAABAAAAAf/AAAAAgAAA/8AAAACAAAAAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcmh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAJEIBAQNwAAADALAAAAMAAAMAHqAUIEHAoQQYh7kWVTcCAgYAgKIAAQAJRAHAYXLIRFNkAAAAGWlwbWEAAAAAAAAAAQABBoECBYaDhAAAACxpbG9jAAAAAEQAAAIAAQAAAAEAAAJUAAAAPAACAAAAAQAAAggAAABMAAAAAW1kYXQAAAAAAAAAmAAAAAZFeGlmAABNTQAqAAAACAADARoABQAAAAEAAAAyARsABQAAAAEAAAA6ASgAAwAAAAEAAgAAAAAAAAAAAGAAAAABAAAAYAAAAAEAAAA4KAGvo0kQ1LimwT9X7O+2d2mm9S1fbO4+QPr688zSSEYAO9f/aZ4z8qGOGueS4/enGGL2Y7p3BfQ=";

function writeHeicFixture(path: string): string {
  writeFileSync(path, Buffer.from(HEIC_BASE64, "base64"));
  return path;
}

type DrawOp = { x: number; y: number; width: number; height: number; name: string };

/**
 * The image draw transforms on a page, parsed from the content stream. pdf-lib
 * emits translate/scale matrices around each `Do`, so accumulate the CTM from
 * each `q` and read the axis-aligned box at `Do`.
 */
function pageImageOps(doc: PDFDocument, pageIndex: number): DrawOp[] {
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  const streams: PDFRawStream[] = [];
  const collect = (ref: PDFStream | PDFRef) => {
    const resolved = ref instanceof PDFStream ? ref : doc.context.lookup(ref);
    if (resolved instanceof PDFRawStream) streams.push(resolved);
  };
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) collect(contents.get(i) as PDFStream | PDFRef);
  } else if (contents) {
    collect(contents as PDFStream | PDFRef);
  }

  const text = streams
    .map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1"))
    .join("\n");

  type Matrix = [number, number, number, number, number, number];
  const identity: Matrix = [1, 0, 0, 1, 0, 0];
  const concat = (m: Matrix, n: Matrix): Matrix => [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];

  const ops: DrawOp[] = [];
  // Row-vector convention: a `cm` M updates the CTM as M Ã- CTM, so points are
  // transformed scale-first then translated.
  let ctm: Matrix = identity;
  const stack: Matrix[] = [];
  for (const line of text.split("\n")) {
    if (line === "q") stack.push(ctm);
    if (line === "Q") ctm = stack.pop() ?? identity;
    const cm = line.match(/^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm$/);
    if (cm) {
      ctm = concat(cm.slice(1).map(Number) as Matrix, ctm);
      continue;
    }
    const doOp = line.match(/^\/(\S+) Do$/);
    if (doOp) ops.push({ x: ctm[4], y: ctm[5], width: ctm[0], height: ctm[3], name: doOp[1] });
  }
  return ops;
}

function pageImageXObjects(doc: PDFDocument, pageIndex: number): PDFRawStream[] {
  const resources = doc.getPage(pageIndex).node.Resources();
  const xobjects = resources?.lookupMaybe(PDFName.XObject, PDFDict);
  const out: PDFRawStream[] = [];
  if (!xobjects) return out;
  for (const key of xobjects.keys()) {
    const stream = xobjects.lookupMaybe(key, PDFStream);
    if (!(stream instanceof PDFRawStream)) continue;
    if (stream.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    out.push(stream);
  }
  return out;
}

async function centrePixel(path: string, pageIndex = 0): Promise<number[]> {
  const renderer = await getPdfRenderer(path);
  try {
    const canvas = await renderer.renderPage(pageIndex, 72);
    const { width, height } = canvas;
    const { data } = canvas
      .getContext("2d")
      .getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1);
    return [data[0], data[1], data[2], data[3]];
  } finally {
    await renderer.close();
  }
}

const isWhite = (px: number[]) => px[0] > 245 && px[1] > 245 && px[2] > 245;

describe("loadImageEmbeddable", () => {
  let dir: string;
  let jpg: string;
  let png: string;
  let webp: string;
  let tiff: string;
  let gif: string;
  let svg: string;
  let bmp: string;

  beforeAll(async () => {
    dir = fixtureDir("convertin");
    jpg = await solid(join(dir, "red.jpg"), "jpeg", 100, 60, { r: 255, g: 0, b: 0 });
    png = await solid(join(dir, "blue.png"), "png", 100, 60, { r: 0, g: 0, b: 255 });
    webp = await solid(join(dir, "green.webp"), "webp", 100, 60, { r: 0, g: 255, b: 0 });
    tiff = await solid(join(dir, "green.tiff"), "tiff", 100, 60, { r: 0, g: 255, b: 0 });
    gif = await solid(join(dir, "green.gif"), "gif", 100, 60, { r: 0, g: 255, b: 0 });
    svg = join(dir, "blue.svg");
    writeFileSync(
      svg,
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="rgb(0,0,255)"/></svg>'
    );
    bmp = makeBmp(join(dir, "green.bmp"), 100, 60, 0, 255, 0);
  });

  it("passes a jpg through untouched", async () => {
    const result = await loadImageEmbeddable(jpg);
    expect(result.kind).toBe("jpg");
    expect(result.widthPx).toBe(100);
    expect(result.heightPx).toBe(60);
    expect(Buffer.from(result.bytes).equals(readFileSync(jpg))).toBe(true);
  });

  it("passes a png through untouched", async () => {
    const result = await loadImageEmbeddable(png);
    expect(result.kind).toBe("png");
    expect(result.widthPx).toBe(100);
    expect(result.heightPx).toBe(60);
    expect(Buffer.from(result.bytes).equals(readFileSync(png))).toBe(true);
  });

  it("transcodes webp/tiff/gif to png bytes", async () => {
    for (const [path, width] of [
      [webp, 100],
      [tiff, 100],
      [gif, 100],
    ] as Array<[string, number]>) {
      const result = await loadImageEmbeddable(path);
      expect(result.kind).toBe("png");
      expect(result.widthPx).toBe(width);
      expect(startsWith(Buffer.from(result.bytes), PNG_MAGIC)).toBe(true);
    }
  });

  it("transcodes an svg through sharp's resvg support", async () => {
    const result = await loadImageEmbeddable(svg);
    expect(result.kind).toBe("png");
    expect(result.widthPx).toBe(120);
    expect(result.heightPx).toBe(80);
    expect(startsWith(Buffer.from(result.bytes), PNG_MAGIC)).toBe(true);
  });

  it("transcodes a bmp via the canvas fallback (sharp's libvips lacks BMP)", async () => {
    const result = await loadImageEmbeddable(bmp);
    expect(result.kind).toBe("png");
    expect(result.widthPx).toBe(100);
    expect(result.heightPx).toBe(60);
    expect(startsWith(Buffer.from(result.bytes), PNG_MAGIC)).toBe(true);
  });

  it("falls back to content sniffing for an unrecognised extension", async () => {
    const mislabelled = join(fixtureDir("convertin"), "mislabelled.dat");
    writeFileSync(mislabelled, readFileSync(png));
    const result = await loadImageEmbeddable(mislabelled);
    expect(result.kind).toBe("png");
    expect(result.widthPx).toBe(100);
    expect(result.heightPx).toBe(60);
  });

  it("trusts content over a lying extension (png bytes named .jpg)", async () => {
    const lying = join(fixtureDir("convertin"), "actually-png.jpg");
    writeFileSync(lying, readFileSync(png));
    const result = await loadImageEmbeddable(lying);
    expect(result.kind).toBe("png");
    expect(result.widthPx).toBe(100);
    expect(result.heightPx).toBe(60);
  });

  it("throws CORRUPT_PDF for a missing file", async () => {
    await expect(loadImageEmbeddable(join(dir, "nope.jpg"))).rejects.toMatchObject({
      code: -32003,
    });
  });

  it("throws CORRUPT_PDF for unreadable image bytes", async () => {
    const corrupt = join(fixtureDir("convertin"), "corrupt.webp");
    writeFileSync(corrupt, Buffer.from("this is not an image at all"));
    await expect(loadImageEmbeddable(corrupt)).rejects.toMatchObject({ code: -32003 });
  });

  it("throws CORRUPT_PDF for a truncated png body (pdf-lib would hang)", async () => {
    const dir2 = fixtureDir("convertin");
    const full = await sharp({
      create: { width: 100, height: 60, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .png()
      .toBuffer();
    const trunc = join(dir2, "half.png");
    writeFileSync(trunc, full.subarray(0, Math.floor(full.length / 2)));
    await expect(loadImageEmbeddable(trunc)).rejects.toMatchObject({ code: -32003 });
  });

  it("throws CORRUPT_PDF for a truncated jpg body (pdf-lib would embed it broken)", async () => {
    const dir2 = fixtureDir("convertin");
    const full = await sharp({
      create: { width: 100, height: 60, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .jpeg()
      .toBuffer();
    const trunc = join(dir2, "half.jpg");
    writeFileSync(trunc, full.subarray(0, Math.floor(full.length / 2)));
    await expect(loadImageEmbeddable(trunc)).rejects.toMatchObject({ code: -32003 });
  });
  it("throws UNSUPPORTED_FORMAT naming psd (not supported in v1)", async () => {
    const psd = join(fixtureDir("convertin"), "layer.psd");
    writeFileSync(psd, Buffer.from("8BPS" + "\x00".repeat(12), "latin1"));
    await expect(loadImageEmbeddable(psd)).rejects.toMatchObject({
      code: -32006,
      message: expect.stringMatching(/psd/i),
    });
  });

  it("throws UNSUPPORTED_FORMAT naming avif (out of the v1 format list)", async () => {
    const avif = join(fixtureDir("convertin"), "photo.avif");
    writeFileSync(avif, Buffer.from("\x00".repeat(16), "latin1"));
    await expect(loadImageEmbeddable(avif)).rejects.toMatchObject({
      code: -32006,
      message: expect.stringMatching(/avif/i),
    });
  });

  it("handles HEIC honestly: converts if the build supports it, else typed error", async () => {
    const heic = writeHeicFixture(join(fixtureDir("convertin"), "sample.heic"));
    try {
      const result = await loadImageEmbeddable(heic);
      expect(result.kind).toBe("png");
      expect(result.widthPx).toBeGreaterThan(0);
    } catch (e) {
      // This build's libheif has no HEVC decoder; the error must name the format.
      expect(e).toMatchObject({
        code: -32006,
        message: expect.stringMatching(/heic/i),
      });
    }
  });
});

describe("runImagesToPdf", () => {
  let dir: string;
  let jpg100: string;
  let jpgRed: string;
  let jpgGreen: string;
  let jpgBlue: string;
  let png100: string;
  let png40: string;

  beforeAll(async () => {
    dir = fixtureDir("convertin");
    jpg100 = await solid(join(dir, "one-100x60.jpg"), "jpeg", 100, 60, { r: 255, g: 0, b: 0 });
    png100 = await solid(join(dir, "one-100x60.png"), "png", 100, 60, { r: 0, g: 0, b: 255 });
    jpgRed = await solid(join(dir, "order-red.jpg"), "jpeg", 100, 60, { r: 255, g: 0, b: 0 });
    jpgGreen = await solid(join(dir, "order-green.jpg"), "jpeg", 100, 60, { r: 0, g: 255, b: 0 });
    jpgBlue = await solid(join(dir, "order-blue.jpg"), "jpeg", 100, 60, { r: 0, g: 0, b: 255 });
    png40 = await solid(join(dir, "one-40x80.png"), "png", 40, 80, { r: 0, g: 255, b: 0 });
  });

  it("writes a single images.pdf with one page per image in fit mode", async () => {
    const out = await runImagesToPdf({ filePaths: [jpg100, png100] }, ctx, outDir());
    expect(out.endsWith("images.pdf")).toBe(true);
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(2);
    const sizes = doc.getPages().map((p) => p.getSize());
    expect(sizes[0].width).toBeCloseTo(100, 3);
    expect(sizes[0].height).toBeCloseTo(60, 3);
    expect(sizes[1].width).toBeCloseTo(100, 3);
    expect(sizes[1].height).toBeCloseTo(60, 3);
  });

  it("sizes each fit page to its own image", async () => {
    const out = await runImagesToPdf({ filePaths: [jpg100, png40] }, ctx, outDir());
    const doc = await PDFDocument.load(readFileSync(out));
    const sizes = doc.getPages().map((p) => p.getSize());
    expect(sizes[0]).toMatchObject({ width: 100, height: 60 });
    expect(sizes[1].width).toBeCloseTo(40, 3);
    expect(sizes[1].height).toBeCloseTo(80, 3);
  });

  it("scales and centres onto a4 portrait", async () => {
    const out = await runImagesToPdf(
      { filePaths: [jpg100], pageSize: "a4" },
      ctx,
      outDir()
    );
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPage(0).getSize()).toMatchObject({ width: 595.28, height: 841.89 });

    const [op] = pageImageOps(doc, 0);
    // scale = 595.28/100 (width-limited); the image keeps its 100:60 aspect.
    expect(op.width).toBeCloseTo(595.28, 2);
    expect(op.height).toBeCloseTo(357.168, 2);
    expect(op.x).toBeCloseTo(0, 2);
    expect(op.y).toBeCloseTo((841.89 - 357.168) / 2, 2);
  });

  it("honours landscape orientation for a4", async () => {
    const out = await runImagesToPdf(
      { filePaths: [jpg100], pageSize: "a4", orientation: "landscape" },
      ctx,
      outDir()
    );
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPage(0).getSize()).toMatchObject({ width: 841.89, height: 595.28 });
    const [op] = pageImageOps(doc, 0);
    expect(op.width).toBeCloseTo(841.89, 2);
    expect(op.height).toBeCloseTo(505.134, 2);
  });

  it("embeds jpg as DCTDecode and png as FlateDecode image XObjects", async () => {
    const out = await runImagesToPdf({ filePaths: [jpg100, png100] }, ctx, outDir());
    const doc = await PDFDocument.load(readFileSync(out));

    const jpgImages = pageImageXObjects(doc, 0);
    expect(jpgImages).toHaveLength(1);
    expect(jpgImages[0].dict.get(PDFName.of("Filter"))?.toString()).toBe("/DCTDecode");

    const pngImages = pageImageXObjects(doc, 1);
    expect(pngImages).toHaveLength(1);
    expect(pngImages[0].dict.get(PDFName.of("Filter"))?.toString()).toBe("/FlateDecode");
  });

  it("converts webp/tiff/gif/bmp/svg each to a single non-blank page", async () => {
    const cases: Array<[string, string]> = [
      [await solid(join(dir, "conv.webp"), "webp", 100, 60, { r: 255, g: 0, b: 0 }), "webp"],
      [await solid(join(dir, "conv.tiff"), "tiff", 100, 60, { r: 255, g: 0, b: 0 }), "tiff"],
      [await solid(join(dir, "conv.gif"), "gif", 100, 60, { r: 255, g: 0, b: 0 }), "gif"],
      [makeBmp(join(dir, "conv.bmp"), 100, 60, 255, 0, 0), "bmp"],
      [
        (() => {
          const p = join(dir, "conv.svg");
          writeFileSync(
            p,
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="rgb(255,0,0)"/></svg>'
          );
          return p;
        })(),
        "svg",
      ],
    ];

    for (const [path, label] of cases) {
      const out = await runImagesToPdf({ filePaths: [path] }, ctx, outDir());
      const doc = await PDFDocument.load(readFileSync(out));
      expect(doc.getPageCount(), label).toBe(1);
      const px = await centrePixel(out);
      expect(isWhite(px), `${label} rendered blank`).toBe(false);
      expect(px[0], label).toBeGreaterThan(200);
      expect(px[1], label).toBeLessThan(80);
      expect(px[2], label).toBeLessThan(80);
    }
  });

  it("keeps the input order across pages", async () => {
    const out = await runImagesToPdf(
      { filePaths: [jpgRed, jpgGreen, jpgBlue] },
      ctx,
      outDir()
    );
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(3);
    const [red, green, blue] = await Promise.all([
      centrePixel(out, 0),
      centrePixel(out, 1),
      centrePixel(out, 2),
    ]);
    expect(red[0]).toBeGreaterThan(200);
    expect(red[1]).toBeLessThan(80);
    expect(green[1]).toBeGreaterThan(200);
    expect(green[0]).toBeLessThan(80);
    expect(blue[2]).toBeGreaterThan(200);
    expect(blue[0]).toBeLessThan(80);
  });

  it("honours a margin in fit mode (page size unchanged, image inset)", async () => {
    const out = await runImagesToPdf(
      { filePaths: [jpg100], margin: 10 },
      ctx,
      outDir()
    );
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPage(0).getSize()).toMatchObject({ width: 100, height: 60 });
    const [op] = pageImageOps(doc, 0);
    // 80x40 box inside 100x60: scale = min(0.8, 0.667) = 0.667.
    expect(op.width).toBeCloseTo(66.667, 2);
    expect(op.height).toBeCloseTo(40, 2);
    expect(op.x).toBeCloseTo(16.667, 2);
    expect(op.y).toBeCloseTo(10, 2);
  });

  it("honours a margin on a4 (image drawn inside the margin box)", async () => {
    const out = await runImagesToPdf(
      { filePaths: [jpg100], pageSize: "a4", margin: 10 },
      ctx,
      outDir()
    );
    const doc = await PDFDocument.load(readFileSync(out));
    const [op] = pageImageOps(doc, 0);
    expect(op.x).toBeGreaterThanOrEqual(10 - 0.01);
    expect(op.y).toBeGreaterThanOrEqual(10 - 0.01);
    expect(op.x + op.width).toBeLessThanOrEqual(595.28 - 10 + 0.01);
    expect(op.y + op.height).toBeLessThanOrEqual(841.89 - 10 + 0.01);
    // Width-limited: 595.28 - 20 available.
    expect(op.width).toBeCloseTo(575.28, 2);
  });

  it("reports progress per image, ending at 100", async () => {
    const events: Array<{ percent: number; pagesDone: number }> = [];
    await runImagesToPdf(
      { filePaths: [jpg100, png100] },
      { ...ctx, notifyProgress: (p) => events.push({ percent: p.percent, pagesDone: p.pagesDone }) },
      outDir()
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ percent: 50, pagesDone: 1 });
    expect(events[events.length - 1].percent).toBe(100);
  });

  it("throws CANCELLED when cancelled after the first image", async () => {
    let cancelled = false;
    const cancelCtx = {
      ...ctx,
      cancelled: () => cancelled,
      notifyProgress: () => {
        cancelled = true;
      },
    };
    await expect(
      runImagesToPdf({ filePaths: [jpg100, png100] }, cancelCtx, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("throws CORRUPT_PDF for a missing input file", async () => {
    await expect(
      runImagesToPdf({ filePaths: [join(dir, "missing.jpg")] }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("throws UNSUPPORTED_FORMAT for a psd input", async () => {
    const psd = join(fixtureDir("convertin"), "input.psd");
    writeFileSync(psd, Buffer.from("8BPS" + "\x00".repeat(12), "latin1"));
    await expect(runImagesToPdf({ filePaths: [psd] }, ctx, outDir())).rejects.toMatchObject({
      code: -32006,
    });
  });

  it("handles a 50-image run producing 50 pages", async () => {
    const batchDir = fixtureDir("convertin/batch");
    const bytes = readFileSync(jpg100);
    const paths: string[] = [];
    for (let i = 0; i < 50; i++) {
      const p = join(batchDir, `img-${i}.jpg`);
      writeFileSync(p, bytes);
      paths.push(p);
    }
    const out = await runImagesToPdf({ filePaths: paths }, ctx, outDir());
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(50);
  });

  it("is wired into the tool registry", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("imagesToPdf")).toBe(true);
  });
});
