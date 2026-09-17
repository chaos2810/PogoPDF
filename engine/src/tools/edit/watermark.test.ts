import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream } from "pdf-lib";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptedPdfBytes, fixtureDir } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { registerTools } from "../registry";
import { runWatermark } from "./watermark";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-watermark-"));
}

async function blankPdf(path: string, pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595.28, 841.89]);
  writeFileSync(path, await doc.save());
  return path;
}

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Rendered at 72 dpi (1pt == 1px). Counts pixels whose darkest channel is below
 * `threshold`; the default keeps near-white (250+) and grey-watermark ink apart.
 */
async function countInk(
  path: string,
  pageIndex: number,
  opts: { rect?: Rect; threshold?: number } = {}
): Promise<number> {
  const renderer = await getPdfRenderer(path);
  try {
    const canvas = await renderer.renderPage(pageIndex, 72);
    const rect = opts.rect ?? { x: 0, y: 0, w: canvas.width, h: canvas.height };
    const { data } = canvas
      .getContext("2d")
      .getImageData(rect.x, rect.y, rect.w, rect.h);
    const threshold = opts.threshold ?? 250;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) {
        count++;
      }
    }
    return count;
  } finally {
    await renderer.close();
  }
}

/** The four displayed quadrants of a page at 72 dpi. */
function quadrants(w: number, h: number): Rect[] {
  const hw = Math.floor(w / 2);
  const hh = Math.floor(h / 2);
  return [
    { x: 0, y: 0, w: hw, h: hh },
    { x: hw, y: 0, w: w - hw, h: hh },
    { x: 0, y: hh, w: hw, h: h - hh },
    { x: hw, y: hh, w: w - hw, h: h - hh },
  ];
}

type TextItem = { str: string; a: number; b: number };

/** pdf.js text items projected into rendered (viewport) space. */
async function renderedItems(path: string, pageIndex: number): Promise<TextItem[]> {
  const renderer = await getPdfRenderer(path);
  try {
    const page = await renderer.getPage(pageIndex);
    const viewport = page.getViewport({ scale: 1 });
    const [va, vb, vc, vd] = viewport.transform;
    const { items } = await page.getTextContent();
    const out: TextItem[] = [];
    for (const item of items) {
      if (!("str" in item) || typeof item.str !== "string" || !item.str.trim()) continue;
      const t = item.transform;
      out.push({
        str: item.str,
        a: va * t[0] + vc * t[1],
        b: vb * t[0] + vd * t[1],
      });
    }
    return out;
  } finally {
    await renderer.close();
  }
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

describe("runWatermark text mode", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("edit-watermark");
  });

  it("stamps grey ink at the displayed center of a blank page", async () => {
    const src = await blankPdf(join(dir, "center.pdf"), 1);
    const out = await runWatermark({ filePath: src, text: "DRAFT" }, ctx, outDir());
    expect(out.endsWith("watermarked.pdf")).toBe(true);

    const center: Rect = { x: 297 - 60, y: 420 - 60, w: 120, h: 120 };
    expect(await countInk(out, 0, { rect: center })).toBeGreaterThan(50);
  });

  it("applies opacity: full-opacity ink far exceeds the 0.05 floor", async () => {
    const src = await blankPdf(join(dir, "opacity.pdf"), 1);
    // Threshold 200: at 0.05 a grey stamp blends to ~249 and is invisible to
    // this count, so a nonzero count at 1.0 proves the ExtGState was applied.
    const faint = await runWatermark(
      { filePath: src, text: "DRAFT", opacity: 0.05, rotation: 0 },
      ctx,
      outDir()
    );
    const solid = await runWatermark(
      { filePath: src, text: "DRAFT", opacity: 1, rotation: 0 },
      ctx,
      outDir()
    );
    const faintInk = await countInk(faint, 0, { threshold: 200 });
    const solidInk = await countInk(solid, 0, { threshold: 200 });
    expect(solidInk).toBeGreaterThan(faintInk);
    expect(solidInk).toBeGreaterThan(100);
  });

  it("tiles ink across all four displayed quadrants", async () => {
    const src = await blankPdf(join(dir, "tile.pdf"), 1);
    const out = await runWatermark(
      { filePath: src, text: "DRAFT", position: "tile", rotation: 45 },
      ctx,
      outDir()
    );
    const renderer = await getPdfRenderer(out);
    const { width, height } = await renderer.renderPage(0, 72);
    await renderer.close();
    for (const rect of quadrants(width, height)) {
      expect(await countInk(out, 0, { rect })).toBeGreaterThan(20);
    }
  });

  it("rotates the drawn text: b differs between 0 and 45 degrees", async () => {
    const src = await blankPdf(join(dir, "rotation.pdf"), 1);
    const flat = await runWatermark(
      { filePath: src, text: "DRAFT", rotation: 0 },
      ctx,
      outDir()
    );
    const tilted = await runWatermark(
      { filePath: src, text: "DRAFT", rotation: 45 },
      ctx,
      outDir()
    );
    const [flatItem] = await renderedItems(flat, 0);
    const [tiltedItem] = await renderedItems(tilted, 0);
    expect(Math.abs(flatItem.b)).toBeLessThan(0.001);
    expect(Math.abs(tiltedItem.b)).toBeGreaterThan(0.5);
  });

  it("stamps only the selected pages", async () => {
    const src = await blankPdf(join(dir, "selection.pdf"), 3);
    const out = await runWatermark(
      { filePath: src, text: "DRAFT", pages: "1", rotation: 0 },
      ctx,
      outDir()
    );
    expect(await countInk(out, 0)).toBeGreaterThan(50);
    expect(await countInk(out, 1)).toBe(0);
    expect(await countInk(out, 2)).toBe(0);
  });

  it("renders at the raised 200pt font-size bound", async () => {
    const src = await blankPdf(join(dir, "large.pdf"), 1);
    const out = await runWatermark(
      { filePath: src, text: "D", fontSize: 200, rotation: 0 },
      ctx,
      outDir()
    );
    expect(await countInk(out, 0)).toBeGreaterThan(100);
  });

  it("rejects empty text as INVALID_INPUT, not an internal error", async () => {
    const src = await blankPdf(join(dir, "empty.pdf"), 1);
    await expect(
      runWatermark({ filePath: src, text: "" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32001 });
    await expect(
      runWatermark({ filePath: src, text: "   " }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("rejects non-Latin text as INVALID_INPUT, not an internal error", async () => {
    const src = await blankPdf(join(dir, "cjk.pdf"), 1);
    await expect(
      runWatermark({ filePath: src, text: "第 1 頁" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("reports progress per page, ending at 100", async () => {
    const src = await blankPdf(join(dir, "progress.pdf"), 3);
    const events: number[] = [];
    await runWatermark(
      { filePath: src, text: "DRAFT" },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events).toEqual([33, 67, 100]);
  });

  it("throws CANCELLED when cancelled between pages", async () => {
    const src = await blankPdf(join(dir, "cancel.pdf"), 3);
    let cancelled = false;
    const cancelCtx = {
      ...ctx,
      cancelled: () => cancelled,
      notifyProgress: () => {
        cancelled = true;
      },
    };
    await expect(
      runWatermark({ filePath: src, text: "DRAFT" }, cancelCtx, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runWatermark({ filePath: enc, text: "DRAFT" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
  });
});

describe("runWatermark image mode", () => {
  let dir: string;
  let png: string;

  beforeAll(async () => {
    dir = fixtureDir("edit-watermark");
    png = join(dir, "red.png");
    const bytes = await sharp({
      create: { width: 100, height: 60, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    writeFileSync(png, bytes);
  });

  it("embeds the image XObject and renders it centered", async () => {
    const src = await blankPdf(join(dir, "image.pdf"), 1);
    const out = await runWatermark(
      { filePath: src, imagePath: png, opacity: 1 },
      ctx,
      outDir()
    );

    const doc = await PDFDocument.load(readFileSync(out));
    expect(pageImageXObjects(doc, 0).length).toBe(1);

    const renderer = await getPdfRenderer(out);
    try {
      const canvas = await renderer.renderPage(0, 72);
      const { data } = canvas
        .getContext("2d")
        .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1);
      expect(data[0]).toBeGreaterThan(200);
      expect(data[1]).toBeLessThan(60);
    } finally {
      await renderer.close();
    }
  });

  it("applies opacity to the image stamp", async () => {
    const src = await blankPdf(join(dir, "image-opacity.pdf"), 1);
    const out = await runWatermark({ filePath: src, imagePath: png }, ctx, outDir());
    const renderer = await getPdfRenderer(out);
    try {
      const canvas = await renderer.renderPage(0, 72);
      const { data } = canvas
        .getContext("2d")
        .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1);
      // Default opacity 0.15: red over white leaves a light pink, not pure red.
      expect(data[0]).toBeGreaterThan(200);
      expect(data[1]).toBeGreaterThan(150);
    } finally {
      await renderer.close();
    }
  });
});

describe("edit registry", () => {
  it("registers watermark", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("watermark")).toBe(true);
  });
});
