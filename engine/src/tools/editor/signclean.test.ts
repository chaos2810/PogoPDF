import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
} from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnnotationSchema } from "@pogopdf/contracts";
import type { Annotation } from "@pogopdf/contracts";
import { encryptedPdfBytes, fixtureDir, makePdf } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { registerTools } from "../registry";
import { writeAnnotations } from "./annotations";
import { runSign } from "./sign";
import { runStamp } from "./stamp";
import { runRemoveAnnotations } from "./removeannotations";
import { runRemoveBlankPages } from "./removeblankpages";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-signclean-"));
}

/** A blank PDF, optionally with page sizes/rotations (editor.test.ts pattern). */
async function blankPdf(
  path: string,
  pages = 1,
  opts: { size?: [number, number]; rotations?: number[] } = {}
): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(opts.size ?? [595.28, 841.89]);
    if (opts.rotations?.[i]) page.setRotation(degrees(opts.rotations[i]));
  }
  writeFileSync(path, await doc.save());
  return path;
}

async function loadOut(path: string): Promise<PDFDocument> {
  return PDFDocument.load(readFileSync(path));
}

type Rect = { x: number; y: number; w: number; h: number };

async function samplePixel(
  path: string,
  pageIndex: number,
  x: number,
  y: number
): Promise<[number, number, number]> {
  const renderer = await getPdfRenderer(path);
  try {
    const canvas = await renderer.renderPage(pageIndex, 72);
    const { data } = canvas
      .getContext("2d")
      .getImageData(Math.floor(x), Math.floor(y), 1, 1);
    return [data[0], data[1], data[2]];
  } finally {
    await renderer.close();
  }
}

/** Count near-black ink pixels in a displayed-frame region at 72 dpi. */
async function countInk(
  path: string,
  pageIndex: number,
  rect: Rect,
  threshold = 200
): Promise<number> {
  const renderer = await getPdfRenderer(path);
  try {
    const canvas = await renderer.renderPage(pageIndex, 72);
    const { data } = canvas
      .getContext("2d")
      .getImageData(rect.x, rect.y, rect.w, rect.h);
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

/** Count pixels whose blue channel dominates (a color probe). */
async function countBlue(
  path: string,
  pageIndex: number,
  rect: Rect
): Promise<number> {
  const renderer = await getPdfRenderer(path);
  try {
    const canvas = await renderer.renderPage(pageIndex, 72);
    const { data } = canvas
      .getContext("2d")
      .getImageData(rect.x, rect.y, rect.w, rect.h);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 2] > 120 && data[i + 2] - data[i] > 60) count++;
    }
    return count;
  } finally {
    await renderer.close();
  }
}

async function pageTexts(path: string): Promise<string[]> {
  const renderer = await getPdfRenderer(path);
  try {
    const out: string[] = [];
    for (let i = 0; i < renderer.pageCount; i++) {
      out.push(await extractPageText(await renderer.getPage(i)));
    }
    return out;
  } finally {
    await renderer.close();
  }
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

function pageAnnots(doc: PDFDocument, pageIndex: number): PDFDict[] {
  const raw: unknown = doc.getPage(pageIndex).node.get(PDFName.of("Annots"));
  const arr = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
  if (!(arr instanceof PDFArray)) return [];
  const out: PDFDict[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const entry = arr.get(i);
    const dict = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
    if (dict instanceof PDFDict) out.push(dict);
  }
  return out;
}

function subtype(dict: PDFDict): string {
  const value = dict.get(PDFName.of("Subtype"));
  if (!(value instanceof PDFName)) throw new Error("annot has no /Subtype");
  return value.asString().replace(/^\//, "");
}

/** Every /BaseFont name in a page's /Font resources (proves the oblique face). */
function pageFontBaseNames(doc: PDFDocument, pageIndex: number): string[] {
  const fonts = doc
    .getPage(pageIndex)
    .node.Resources()
    ?.lookupMaybe(PDFName.of("Font"), PDFDict);
  const out: string[] = [];
  if (!fonts) return out;
  for (const key of fonts.keys()) {
    const fd = fonts.lookupMaybe(key, PDFDict);
    const bf = fd?.get(PDFName.of("BaseFont"));
    if (bf) out.push(bf.toString());
  }
  return out;
}

function hasImageXObject(doc: PDFDocument, pageIndex: number): boolean {
  const resources = doc.getPage(pageIndex).node.Resources();
  const xobjects = resources?.lookupMaybe(PDFName.XObject, PDFDict);
  if (!xobjects) return false;
  for (const key of xobjects.keys()) {
    // An embedded image resolves to a PDFRawStream whose /Subtype lives on
    // `.dict`; lookupMaybe(PDFDict) would throw on the stream type.
    const stream = xobjects.lookupMaybe(key, PDFStream);
    if (
      stream instanceof PDFRawStream &&
      stream.dict.get(PDFName.of("Subtype"))?.toString() === "/Image"
    ) {
      return true;
    }
  }
  return false;
}

/** The two-page fixture: model annotations plus an optional raw /Link annot. */
async function annotFixture(
  path: string,
  opts: { model?: Annotation[]; link?: boolean } = {}
): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  doc.addPage([595.28, 841.89]);
  if (opts.model) {
    // Parse through the schema so colour/opacity/lineWidth defaults are applied
    // (writeAnnotations expects fully-defaulted model items).
    const parsed = opts.model.map((a) => AnnotationSchema.parse(a));
    await writeAnnotations(doc, parsed, { cancelled: () => false });
  }
  if (opts.link) {
    const dict = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 10, 60, 30],
      A: { S: "URI", URI: PDFString.of("https://example.com") },
    });
    doc.getPage(0).node.addAnnot(doc.context.register(dict));
  }
  writeFileSync(path, await doc.save());
  return path;
}

function baseModelAnnots(): Annotation[] {
  return [
    { type: "rect", page: 1, rect: { x: 10, y: 10, w: 40, h: 30 } },
    { type: "highlight", page: 1, rect: { x: 10, y: 60, w: 80, h: 14 } },
    { type: "freehand", page: 1, points: [{ x: 10, y: 100 }, { x: 60, y: 120 }] },
    { type: "freetext", page: 1, rect: { x: 10, y: 140, w: 80, h: 20 }, text: "Note" },
    { type: "line", page: 1, rect: { x: 10, y: 180, w: 50, h: 30 } },
    { type: "rect", page: 2, rect: { x: 10, y: 10, w: 40, h: 30 } },
  ] as Annotation[];
}

const A4_W = 595.28;
const A4_H = 841.89;

describe("runSign draw mode", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("signclean-sign");
  });

  it("draws page-normalized ink at the displayed location on a rotated page", async () => {
    // 200x100 with /Rotate 90 displays as 100x200.
    const src = await blankPdf(join(dir, "draw-rot.pdf"), 1, {
      size: [200, 100],
      rotations: [90],
    });
    // Normalized points (0..1) map into the DISPLAYED page box; x/y 0 means
    // the ink is already at its absolute displayed location. `scale` thickens
    // the stroke only, so the points stay on the page.
    const out = await runSign(
      {
        filePath: src,
        mode: "draw",
        inkPoints: [
          { x: 0.35, y: 0.45 },
          { x: 0.65, y: 0.45 },
        ],
        x: 0,
        y: 0,
      },
      ctx,
      outDir()
    );
    expect(out.endsWith("signed.pdf")).toBe(true);
    // The ink is page content, not an annot dict.
    expect(pageAnnots(await loadOut(out), 0)).toHaveLength(0);
    // Displayed centre of a 100x200 box: ink lands at displayed (35..65, 90).
    expect(await countInk(out, 0, { x: 28, y: 82, w: 44, h: 16 })).toBeGreaterThan(0);
    // Nothing far away.
    expect(await countInk(out, 0, { x: 70, y: 160, w: 25, h: 25 })).toBe(0);
  });

  it("translates the stroke by the x/y offset", async () => {
    const src = await blankPdf(join(dir, "draw-offset.pdf"), 1);
    const points = [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.1 },
    ];
    const out = await runSign(
      { filePath: src, mode: "draw", inkPoints: points, x: 100, y: 200 },
      ctx,
      outDir()
    );
    // Without the offset the ink would sit near displayed (60..120, 84); with
    // it, at (160..220, 284).
    expect(await countInk(out, 0, { x: 150, y: 276, w: 80, h: 16 })).toBeGreaterThan(0);
    expect(await countInk(out, 0, { x: 50, y: 70, w: 100, h: 30 })).toBe(0);
  });

  it("scale enlarges the drawn ink", async () => {
    const src = await blankPdf(join(dir, "draw-scale.pdf"), 1);
    const points = [
      { x: 0.45, y: 0.5 },
      { x: 0.55, y: 0.5 },
    ];
    const small = await runSign(
      { filePath: src, mode: "draw", inkPoints: points, x: 0, y: 0, scale: 1 },
      ctx,
      outDir()
    );
    const large = await runSign(
      { filePath: src, mode: "draw", inkPoints: points, x: 0, y: 0, scale: 3 },
      ctx,
      outDir()
    );
    const region = {
      x: Math.round(A4_W * 0.4),
      y: Math.round(A4_H * 0.45),
      w: Math.round(A4_W * 0.2),
      h: Math.round(A4_H * 0.1),
    };
    expect(await countInk(large, 0, region)).toBeGreaterThan(await countInk(small, 0, region));
  });
});

describe("runSign type mode", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("signclean-sign");
  });

  it("draws oblique text at the baseline anchor on a rotated page", async () => {
    const src = await blankPdf(join(dir, "type-rot.pdf"), 1, {
      size: [200, 100],
      rotations: [90],
    });
    const out = await runSign(
      { filePath: src, mode: "type", text: "Ada", x: 10, y: 50 },
      ctx,
      outDir()
    );
    expect((await pageTexts(out))[0]).toContain("Ada");
    // Ink sits above and right of the displayed baseline anchor (10,50).
    expect(await countInk(out, 0, { x: 5, y: 25, w: 70, h: 30 })).toBeGreaterThan(0);
    const faces = pageFontBaseNames(await loadOut(out), 0);
    expect(faces.some((f) => /Oblique/i.test(f))).toBe(true);
  });

  it("rejects CJK text as INVALID_INPUT, not an internal error", async () => {
    const src = await blankPdf(join(dir, "type-cjk.pdf"), 1);
    await expect(
      runSign({ filePath: src, mode: "type", text: "第一頁", x: 10, y: 10 }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32001 });
  });
});

describe("runSign image mode", () => {
  let dir: string;
  let png: string;

  beforeAll(async () => {
    dir = fixtureDir("signclean-sign");
    png = join(dir, "sig.png");
    writeFileSync(
      png,
      await sharp({
        create: { width: 100, height: 60, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .png()
        .toBuffer()
    );
  });

  it("draws the image at the top-left anchor, scaled, on a rotated page", async () => {
    const src = await blankPdf(join(dir, "image-rot.pdf"), 1, {
      size: [200, 100],
      rotations: [90],
    });
    const out = await runSign(
      { filePath: src, mode: "image", imageFile: png, x: 0, y: 0, scale: 1 },
      ctx,
      outDir()
    );
    expect(hasImageXObject(await loadOut(out), 0)).toBe(true);
    // Displayed box (0,0)-(100,60): the centre (50,30) is red.
    const [r, g, b] = await samplePixel(out, 0, 50, 30);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });
});

describe("runSign errors and cancellation", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("signclean-errors");
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted-sign.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runSign(
        {
          filePath: enc,
          mode: "draw",
          inkPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          x: 0,
          y: 0,
        },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32002 });
  });

  it("throws CANCELLED when the job is already cancelled", async () => {
    const src = await blankPdf(join(dir, "cancel-sign.pdf"), 1);
    await expect(
      runSign(
        {
          filePath: src,
          mode: "draw",
          inkPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          x: 0,
          y: 0,
        },
        { ...ctx, cancelled: () => true },
        outDir()
      )
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("runStamp", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("signclean-stamp");
  });

  it("stamps colored text at the baseline anchor", async () => {
    const src = await blankPdf(join(dir, "stamp.pdf"), 1);
    const out = await runStamp(
      { filePath: src, text: "APPROVED", x: 100, y: 200, color: "#0000FF", rotate: 0 },
      ctx,
      outDir()
    );
    expect(out.endsWith("stamped.pdf")).toBe(true);
    expect((await pageTexts(out))[0]).toContain("APPROVED");
    // Glyphs sit above the baseline (displayed y 200), between roughly y 175..200.
    expect(await countBlue(out, 0, { x: 95, y: 172, w: 160, h: 30 })).toBeGreaterThan(10);
  });

  it("rotates the stamp in displayed space", async () => {
    const src = await blankPdf(join(dir, "stamp-rotate.pdf"), 1);
    const flat = await runStamp(
      { filePath: src, text: "STAMP", x: 100, y: 300, rotate: 0 },
      ctx,
      outDir()
    );
    const tilted = await runStamp(
      { filePath: src, text: "STAMP", x: 100, y: 300, rotate: 45 },
      ctx,
      outDir()
    );
    const [flatItem] = await renderedItems(flat, 0);
    const [tiltedItem] = await renderedItems(tilted, 0);
    expect(Math.abs(flatItem.b)).toBeLessThan(0.001);
    expect(Math.abs(tiltedItem.b)).toBeGreaterThan(0.5);
  });

  it("rejects CJK text as INVALID_INPUT", async () => {
    const src = await blankPdf(join(dir, "stamp-cjk.pdf"), 1);
    await expect(
      runStamp({ filePath: src, text: "第一頁", x: 10, y: 10 }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted-stamp.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runStamp({ filePath: enc, text: "X", x: 0, y: 0 }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
  });

  it("throws CANCELLED when the job is already cancelled", async () => {
    const src = await blankPdf(join(dir, "cancel-stamp.pdf"), 1);
    await expect(
      runStamp(
        { filePath: src, text: "X", x: 0, y: 0 },
        { ...ctx, cancelled: () => true },
        outDir()
      )
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("runRemoveAnnotations", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("signclean-removeannot");
  });

  it("removes every annotation when types is omitted", async () => {
    const src = await annotFixture(join(dir, "all.pdf"), { model: baseModelAnnots() });
    const out = await runRemoveAnnotations({ filePath: src }, ctx, outDir());
    expect(out.endsWith("clean.pdf")).toBe(true);
    const doc = await loadOut(out);
    expect(pageAnnots(doc, 0)).toHaveLength(0);
    expect(pageAnnots(doc, 1)).toHaveLength(0);
    expect(doc.getPage(0).node.Annots()).toBeUndefined();
  });

  it("removes link annotations too when removing all", async () => {
    const src = await annotFixture(join(dir, "link-all.pdf"), { link: true });
    const out = await runRemoveAnnotations({ filePath: src }, ctx, outDir());
    expect(pageAnnots(await loadOut(out), 0)).toHaveLength(0);
  });

  it("filters by subtype and keeps the others", async () => {
    const src = await annotFixture(join(dir, "filter.pdf"), { model: baseModelAnnots() });
    const out = await runRemoveAnnotations({ filePath: src, types: ["highlight"] }, ctx, outDir());
    const doc = await loadOut(out);
    const kinds = pageAnnots(doc, 0).map(subtype);
    expect(kinds).not.toContain("Highlight");
    expect(kinds).toEqual(expect.arrayContaining(["Square", "Ink", "FreeText", "Line"]));
    // The untouched second page keeps its Square.
    expect(pageAnnots(doc, 1).map(subtype)).toContain("Square");
  });

  it("treats an empty types array as remove-all (documented default)", async () => {
    const src = await annotFixture(join(dir, "empty-types.pdf"), { model: baseModelAnnots() });
    const out = await runRemoveAnnotations({ filePath: src, types: [] }, ctx, outDir());
    const doc = await loadOut(out);
    expect(pageAnnots(doc, 0)).toHaveLength(0);
    expect(pageAnnots(doc, 1)).toHaveLength(0);
  });

  it("keeps link annotations when filtering by type", async () => {
    const src = await annotFixture(join(dir, "link-filter.pdf"), {
      model: baseModelAnnots(),
      link: true,
    });
    const out = await runRemoveAnnotations({ filePath: src, types: ["rect"] }, ctx, outDir());
    const kinds = pageAnnots(await loadOut(out), 0).map(subtype);
    expect(kinds).not.toContain("Square");
    expect(kinds).toEqual(expect.arrayContaining(["Link", "Highlight", "Ink", "FreeText", "Line"]));
  });

  it("maps line and arrow to their shared /Line subtype", async () => {
    const model: Annotation[] = [
      { type: "line", page: 1, rect: { x: 10, y: 10, w: 50, h: 30 } },
      { type: "arrow", page: 1, rect: { x: 10, y: 60, w: 50, h: 30 } },
    ] as Annotation[];
    const src = await annotFixture(join(dir, "shared-line.pdf"), { model });
    // line -> 1 /Line, arrow -> 3 /Line (main + 2 legs).
    expect(pageAnnots(await loadOut(src), 0)).toHaveLength(4);
    const out = await runRemoveAnnotations({ filePath: src, types: ["line"] }, ctx, outDir());
    expect(pageAnnots(await loadOut(out), 0)).toHaveLength(0);
  });

  it("is a no-op success on a file with no annotations", async () => {
    const src = await makePdf(join(dir, "no-annots.pdf"), 2);
    const out = await runRemoveAnnotations({ filePath: src }, ctx, outDir());
    const doc = await loadOut(out);
    expect(doc.getPageCount()).toBe(2);
    expect(pageAnnots(doc, 0)).toHaveLength(0);
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted-removeannot.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(runRemoveAnnotations({ filePath: enc }, ctx, outDir())).rejects.toMatchObject({
      code: -32002,
    });
  });

  it("throws CANCELLED when the job is already cancelled", async () => {
    const src = await annotFixture(join(dir, "cancel-removeannot.pdf"), {
      model: baseModelAnnots(),
    });
    await expect(
      runRemoveAnnotations({ filePath: src }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });
});

/** 55 dense lines of 10pt text: about 9% of the page is non-white ink. */
function denseText(page: PDFPage, font: PDFFont): void {
  for (let i = 0; i < 55; i++) {
    page.drawText("The quick brown fox jumps over the lazy dog near the riverbank at dawn.", {
      x: 50,
      y: 780 - i * 13,
      size: 10,
      font,
    });
  }
}

/** A fixture whose every page carries dense text (so none is blank). */
async function densePdf(path: string, pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) denseText(doc.addPage([595.28, 841.89]), font);
  writeFileSync(path, await doc.save());
  return path;
}

describe("runRemoveBlankPages", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("signclean-removeblank");
  });

  it("drops a white-rect only page from a mixed fixture", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    denseText(doc.addPage([595.28, 841.89]), font);
    const blank = doc.addPage([595.28, 841.89]);
    blank.drawRectangle({ x: 100, y: 400, width: 200, height: 100, color: rgb(1, 1, 1) });
    denseText(doc.addPage([595.28, 841.89]), font);
    const src = join(dir, "mixed.pdf");
    writeFileSync(src, await doc.save());

    const out = await runRemoveBlankPages({ filePath: src }, ctx, outDir());
    expect(out.endsWith("clean.pdf")).toBe(true);
    const loaded = await loadOut(out);
    expect(loaded.getPageCount()).toBe(2);
    expect((await pageTexts(out))[0]).toContain("quick");
    expect((await pageTexts(out))[1]).toContain("quick");
  });

  it("honours the tolerance boundary", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    denseText(doc.addPage([595.28, 841.89]), font);
    // 100x100 pt of ink is about 2% of the page.
    const sparse = doc.addPage([595.28, 841.89]);
    sparse.drawRectangle({ x: 100, y: 300, width: 100, height: 100, color: rgb(0, 0, 0) });
    const src = join(dir, "tolerance.pdf");
    writeFileSync(src, await doc.save());

    const droppedHigh = await runRemoveBlankPages(
      { filePath: src, tolerance: 3 },
      ctx,
      outDir()
    );
    expect((await loadOut(droppedHigh)).getPageCount()).toBe(1);

    const keptLow = await runRemoveBlankPages({ filePath: src, tolerance: 1 }, ctx, outDir());
    expect((await loadOut(keptLow)).getPageCount()).toBe(2);
  });

  it("tolerance 0 removes nothing", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595.28, 841.89]);
    doc.addPage([595.28, 841.89]);
    const src = join(dir, "tolerance-zero.pdf");
    writeFileSync(src, await doc.save());
    const out = await runRemoveBlankPages({ filePath: src, tolerance: 0 }, ctx, outDir());
    expect((await loadOut(out)).getPageCount()).toBe(2);
  });

  it("refuses an all-blank document as INVALID_INPUT", async () => {
    const src = await blankPdf(join(dir, "all-blank.pdf"), 2);
    await expect(
      runRemoveBlankPages({ filePath: src }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted-blank.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(runRemoveBlankPages({ filePath: enc }, ctx, outDir())).rejects.toMatchObject({
      code: -32002,
    });
  });

  it("reports progress per page, ending at 100", async () => {
    const src = await densePdf(join(dir, "progress.pdf"), 3);
    const events: number[] = [];
    await runRemoveBlankPages(
      { filePath: src },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events).toEqual([33, 67, 100]);
  });

  it("throws CANCELLED mid-run when cancelled after the first page", async () => {
    const src = await densePdf(join(dir, "cancel-blank.pdf"), 3);
    let cancelled = false;
    const cancelCtx = {
      ...ctx,
      cancelled: () => cancelled,
      notifyProgress: () => {
        cancelled = true;
      },
    };
    await expect(runRemoveBlankPages({ filePath: src }, cancelCtx, outDir())).rejects.toMatchObject(
      { code: -32005 }
    );
  });
});

describe("sign and cleanup registry", () => {
  it("registers sign, stamp, removeAnnotations, and removeBlankPages", () => {
    const tools = new Map();
    registerTools(tools);
    for (const id of ["sign", "stamp", "removeAnnotations", "removeBlankPages"]) {
      expect(tools.has(id)).toBe(true);
    }
  });
});
