import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  degrees,
} from "pdf-lib";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Annotation } from "@pogopdf/contracts";
import { encryptedPdfBytes, fixtureDir, makePdf } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { registerTools } from "../registry";
import { writeAnnotations } from "./annotations";
import { runEditorSave } from "./editorSave";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-editor-"));
}

/** A blank A4 page: the annotation geometry is the only content. */
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

/**
 * Walk a page's produced /Annots as raw PDFDicts. Deliberately does NOT use
 * `lookupMaybe` (it throws on a type mismatch): raw `get` plus `instanceof`
 * is the same narrowing pattern bookmarks.ts uses for outlines.
 */
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

function num(dict: PDFDict, key: string): number {
  const value = dict.get(PDFName.of(key));
  if (!(value instanceof PDFNumber)) throw new Error(`annot has no numeric /${key}`);
  return value.asNumber();
}

function numbers(dict: PDFDict, key: string): number[] {
  const raw = dict.get(PDFName.of(key));
  if (!(raw instanceof PDFArray)) throw new Error(`annot has no array /${key}`);
  const out: number[] = [];
  for (let i = 0; i < raw.size(); i++) {
    const value = raw.get(i);
    if (!(value instanceof PDFNumber)) throw new Error(`/${key}[${i}] is not a number`);
    out.push(value.asNumber());
  }
  return out;
}

function name(dict: PDFDict, key: string): string {
  const value = dict.get(PDFName.of(key));
  if (!(value instanceof PDFName)) throw new Error(`annot has no name /${key}`);
  return value.asString();
}

function title(dict: PDFDict): string {
  const value = dict.get(PDFName.of("T"));
  if (value instanceof PDFString) return value.asString();
  if (value instanceof PDFHexString) return value.decodeText();
  throw new Error("annot has no /T title");
}

/** The font resource key a FreeText /DA string references, without the slash. */
function daFontKey(dict: PDFDict): string {
  const da = dict.get(PDFName.of("DA"));
  if (!(da instanceof PDFString)) throw new Error("FreeText annot has no /DA string");
  const key = /^\/(\S+)\s/.exec(da.asString())?.[1];
  if (!key) throw new Error(`cannot parse a /DA font key from: ${da.asString()}`);
  return key;
}

/** The page's own /Font resource dict (the page /Font, not the annot /DR). */
function pageFontDict(doc: PDFDocument, pageIndex: number): PDFDict | undefined {
  return doc.getPage(pageIndex).node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
}

function onlyAnnot(doc: PDFDocument, pageIndex = 0): PDFDict {
  const annots = pageAnnots(doc, pageIndex);
  expect(annots).toHaveLength(1);
  return annots[0];
}

async function loadOut(path: string): Promise<PDFDocument> {
  return PDFDocument.load(readFileSync(path));
}

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

/** Rect annotation helper: the displayed frame is x from the left, y from the top. */
function rectAnnot(type: Annotation["type"], rect: Annotation["rect"], extra: Partial<Annotation> = {}): Annotation {
  return { type, page: 1, rect, ...extra } as Annotation;
}

const A4_W = 595.28;
const A4_H = 841.89;

describe("runEditorSave annotation dictionaries", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("editor-annotations");
  });

  it("maps a displayed rect to the page's user space (/Square)", async () => {
    const src = await blankPdf(join(dir, "square.pdf"));
    const out = await runEditorSave(
      { filePath: src, annotations: [rectAnnot("rect", { x: 100, y: 120, w: 80, h: 40 })] },
      ctx,
      outDir()
    );
    expect(out.endsWith("edited.pdf")).toBe(true);

    const dict = onlyAnnot(await loadOut(out));
    expect(name(dict, "Subtype")).toBe("/Square");
    // Displayed y is from the top, so /Rect is [x, H-y-h, x+w, H-y].
    expect(numbers(dict, "Rect")).toEqual([100, A4_H - 120 - 40, 180, A4_H - 120]);
    expect(title(dict)).toBe("PogoPDF");
    expect(num(dict, "F")).toBe(4);
    expect(numbers(dict, "C")).toHaveLength(3);
  });

  it("writes an ellipse as /Circle", async () => {
    const src = await blankPdf(join(dir, "circle.pdf"));
    const out = await runEditorSave(
      { filePath: src, annotations: [rectAnnot("ellipse", { x: 20, y: 30, w: 60, h: 25 })] },
      ctx,
      outDir()
    );
    expect(name(onlyAnnot(await loadOut(out)), "Subtype")).toBe("/Circle");
  });

  it("writes a line as /Line with /L endpoints from the rect", async () => {
    const src = await blankPdf(join(dir, "line.pdf"));
    const out = await runEditorSave(
      { filePath: src, annotations: [rectAnnot("line", { x: 10, y: 40, w: 100, h: 50 })] },
      ctx,
      outDir()
    );
    const dict = onlyAnnot(await loadOut(out));
    expect(name(dict, "Subtype")).toBe("/Line");
    const l = numbers(dict, "L");
    expect(l).toHaveLength(4);
    // Displayed top-left (10,40) and bottom-right (110,90) in user space.
    expect(l).toEqual([10, A4_H - 40, 110, A4_H - 90]);
  });

  it("writes an arrow as a main /Line plus two head legs", async () => {
    const src = await blankPdf(join(dir, "arrow.pdf"));
    const out = await runEditorSave(
      { filePath: src, annotations: [rectAnnot("arrow", { x: 10, y: 40, w: 100, h: 50 })] },
      ctx,
      outDir()
    );
    const annots = pageAnnots(await loadOut(out), 0);
    expect(annots).toHaveLength(3);
    for (const dict of annots) {
      expect(name(dict, "Subtype")).toBe("/Line");
      expect(numbers(dict, "L")).toHaveLength(4);
      expect(title(dict)).toBe("PogoPDF");
    }
  });

  it("writes highlight, underline, and strikeout as markup annots with quadpoints", async () => {
    const cases: Array<[Annotation["type"], string]> = [
      ["highlight", "/Highlight"],
      ["underline", "/Underline"],
      ["strikeout", "/StrikeOut"],
    ];
    for (const [type, subtype] of cases) {
      const src = await blankPdf(join(dir, `${type}.pdf`));
      const out = await runEditorSave(
        {
          filePath: src,
          annotations: [rectAnnot(type, { x: 30, y: 50, w: 200, h: 18 })],
        },
        ctx,
        outDir()
      );
      const dict = onlyAnnot(await loadOut(out));
      expect(name(dict, "Subtype")).toBe(subtype);
      // One spec quad: upper-left, upper-right, lower-left, lower-right.
      const quad = numbers(dict, "QuadPoints");
      expect(quad).toHaveLength(8);
      const y2 = A4_H - 50;
      const y1 = A4_H - 68;
      const expected = [30, y2, 230, y2, 30, y1, 230, y1];
      quad.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 2));
      expect(numbers(dict, "IC")).toHaveLength(3);
      expect(numbers(dict, "Rect")).toEqual([30, y1, 230, y2]);
    }
  });

  it("writes freehand as /Ink with an /InkList stroke of every point", async () => {
    const src = await blankPdf(join(dir, "ink.pdf"));
    const points = [
      { x: 100, y: 100 },
      { x: 150, y: 120 },
      { x: 200, y: 110 },
    ];
    const out = await runEditorSave(
      {
        filePath: src,
        annotations: [{ type: "freehand", page: 1, points }],
      },
      ctx,
      outDir()
    );
    const dict = onlyAnnot(await loadOut(out));
    expect(name(dict, "Subtype")).toBe("/Ink");
    expect(name(dict, "Intent")).toBe("/PD");
    const inkList = dict.get(PDFName.of("InkList"));
    expect(inkList).toBeInstanceOf(PDFArray);
    const strokes = inkList as PDFArray;
    expect(strokes.size()).toBe(1);
    const stroke = strokes.get(0);
    expect(stroke).toBeInstanceOf(PDFArray);
    const coords: number[] = [];
    const strokeArr = stroke as PDFArray;
    for (let i = 0; i < strokeArr.size(); i++) {
      coords.push((strokeArr.get(i) as PDFNumber).asNumber());
    }
    expect(coords).toEqual(points.flatMap((p) => [p.x, A4_H - p.y]));
  });

  it("writes text and freetext as /FreeText with a /DA string and clamped size", async () => {
    const src = await blankPdf(join(dir, "text.pdf"));
    for (const type of ["text", "freetext"] as const) {
      const out = await runEditorSave(
        {
          filePath: src,
          annotations: [
            rectAnnot(type, { x: 40, y: 60, w: 220, h: 30 }, { text: "Hello", fontSize: 200 }),
          ],
        },
        ctx,
        outDir()
      );
      const dict = onlyAnnot(await loadOut(out));
      expect(name(dict, "Subtype")).toBe("/FreeText");
      const da = dict.get(PDFName.of("DA"));
      expect(da, "FreeText needs a /DA").toBeDefined();
      // fontSize 200 clamps to 96.
      expect(da!.toString()).toContain(" 96 Tf");
      const contents = dict.get(PDFName.of("Contents"));
      expect(contents).toBeDefined();
      // The default appearance font must be present in the page's /Font dict.
      const pageFonts = pageFontDict(await loadOut(out), 0);
      expect(pageFonts, "FreeText font must sit in the page /Font dict").toBeDefined();
      expect(pageFonts!.has(PDFName.of(daFontKey(dict)))).toBe(true);
      expect(numbers(dict, "C")).toHaveLength(3);
      expect(num(dict, "CA")).toBe(1);
    }
  });

  it("carries a /DR that resolves the /DA font to a real font object", async () => {
    const src = await blankPdf(join(dir, "text-dr.pdf"));
    const out = await runEditorSave(
      {
        filePath: src,
        annotations: [rectAnnot("freetext", { x: 40, y: 60, w: 220, h: 30 }, { text: "Hello" })],
      },
      ctx,
      outDir()
    );

    const doc = await loadOut(out);
    const dict = onlyAnnot(doc);
    const key = daFontKey(dict);

    // The /DA references the annot's own /DR font, not only the page /Font.
    const dr = dict.lookupMaybe(PDFName.of("DR"), PDFDict);
    expect(dr, "FreeText annot needs /DR default resources").toBeDefined();
    const drFonts = dr!.lookupMaybe(PDFName.of("Font"), PDFDict);
    expect(drFonts, "/DR needs a /Font dict").toBeDefined();
    expect(drFonts!.has(PDFName.of(key))).toBe(true);

    const font = drFonts!.lookupMaybe(PDFName.of(key), PDFDict);
    expect(font, "/DR /Font key must resolve to a font dict").toBeDefined();
    expect(font!.get(PDFName.of("Type"))?.toString()).toBe("/Font");
    expect(font!.get(PDFName.of("BaseFont"))?.toString()).toBe("/Helvetica");

    // The same font is also registered in the page /Font under the same key.
    const pageFonts = pageFontDict(doc, 0);
    expect(pageFonts!.has(PDFName.of(key))).toBe(true);
  });

  it("honors the annotation line width in each stroke annot's /BS", async () => {
    const cases: Array<[Annotation["type"], number]> = [
      ["rect", 5],
      ["ellipse", 7],
      ["line", 3],
      ["arrow", 4],
      ["freehand", 6],
    ];
    for (const [type, width] of cases) {
      const src = await blankPdf(join(dir, `bs-${type}.pdf`));
      const annot: Annotation =
        type === "freehand"
          ? ({ type, page: 1, lineWidth: width, points: [{ x: 10, y: 10 }, { x: 60, y: 40 }] } as Annotation)
          : rectAnnot(type, { x: 10, y: 10, w: 60, h: 40 }, { lineWidth: width });
      const out = await runEditorSave({ filePath: src, annotations: [annot] }, ctx, outDir());
      const annots = pageAnnots(await loadOut(out), 0);
      expect(annots.length).toBeGreaterThan(0);
      for (const dict of annots) {
        const bs = dict.lookupMaybe(PDFName.of("BS"), PDFDict);
        expect(bs, `${type} annot needs /BS`).toBeDefined();
        expect(bs!.lookupMaybe(PDFName.of("W"), PDFNumber)?.asNumber()).toBe(width);
      }
    }
  });

  it("draws an image mark into page content as an XObject at the rect", async () => {
    const png = join(dir, "mark.png");
    writeFileSync(
      png,
      await sharp({
        create: { width: 60, height: 40, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .png()
        .toBuffer()
    );
    const src = await blankPdf(join(dir, "image.pdf"));
    const out = await runEditorSave(
      {
        filePath: src,
        annotations: [{ type: "image", page: 1, imagePath: png, rect: { x: 50, y: 50, w: 120, h: 80 } }],
      },
      ctx,
      outDir()
    );

    const doc = await loadOut(out);
    // Image marks are flattened into content, not annot dicts.
    expect(pageAnnots(doc, 0)).toHaveLength(0);
    const resources = doc.getPage(0).node.Resources();
    const xobjects = resources?.lookupMaybe(PDFName.XObject, PDFDict);
    expect(xobjects, "image mark must embed an XObject").toBeDefined();
    let found = false;
    for (const key of xobjects!.keys()) {
      const stream = xobjects!.lookupMaybe(key, PDFStream);
      if (stream instanceof PDFRawStream && stream.dict.get(PDFName.of("Subtype"))?.toString() === "/Image") {
        found = true;
      }
    }
    expect(found).toBe(true);

    // The red image renders at the rect's displayed center.
    const [r, g, b] = await samplePixel(out, 0, 110, 90);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it("keeps the annotation's /CA opacity and /C colour", async () => {
    const src = await blankPdf(join(dir, "style.pdf"));
    const out = await runEditorSave(
      {
        filePath: src,
        annotations: [
          rectAnnot("rect", { x: 10, y: 10, w: 30, h: 30 }, { color: "#0000FF", opacity: 0.5 }),
        ],
      },
      ctx,
      outDir()
    );
    const dict = onlyAnnot(await loadOut(out));
    expect(numbers(dict, "C")).toEqual([0, 0, 1]);
    expect(num(dict, "CA")).toBeCloseTo(0.5, 5);
  });
});

describe("runEditorSave rotation-aware geometry", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("editor-rotation");
  });

  it("lands a rect at the displayed centre of a /Rotate 90 page", async () => {
    // 200x100 with /Rotate 90 displays as 100x200.
    const src = await blankPdf(join(dir, "rot90.pdf"), 1, { size: [200, 100], rotations: [90] });
    const rect = { x: 100 / 2 - 10, y: 200 / 2 - 5, w: 20, h: 10 };
    const out = await runEditorSave(
      { filePath: src, annotations: [rectAnnot("rect", rect)] },
      ctx,
      outDir()
    );
    const dict = onlyAnnot(await loadOut(out));
    // toUnrotated(90) maps displayed (rx from left, ry from top) to (ry, rx).
    const x1 = Math.min(rect.y, rect.y + rect.h);
    const y1 = Math.min(rect.x, rect.x + rect.w);
    const x2 = Math.max(rect.y, rect.y + rect.h);
    const y2 = Math.max(rect.x, rect.x + rect.w);
    expect(numbers(dict, "Rect")).toEqual([x1, y1, x2, y2]);
  });

  it("lands a line on the correct user-space diagonal of a /Rotate 270 page", async () => {
    const src = await blankPdf(join(dir, "rot270.pdf"), 1, { size: [200, 100], rotations: [270] });
    const rect = { x: 10, y: 20, w: 40, h: 30 };
    const out = await runEditorSave(
      { filePath: src, annotations: [rectAnnot("line", rect)] },
      ctx,
      outDir()
    );
    const dict = onlyAnnot(await loadOut(out));
    // toUnrotated(270, 200, 100) maps (rx, ry) -> (width - ry, height - rx).
    const start = { x: 200 - rect.y, y: 100 - rect.x };
    const end = { x: 200 - (rect.y + rect.h), y: 100 - (rect.x + rect.w) };
    expect(numbers(dict, "L")).toEqual([start.x, start.y, end.x, end.y]);
  });
});

describe("runEditorSave redaction", () => {
  let dir: string;
  let two: string;

  beforeAll(async () => {
    dir = fixtureDir("editor-redaction");
    two = await makePdf(join(dir, "two-pages.pdf"), 2);
  });

  it("raster-flattens the marked page and keeps the others intact", async () => {
    const out = await runEditorSave(
      {
        filePath: two,
        annotations: [
          { type: "redact", page: 1, rect: { x: 40, y: 60, w: 320, h: 70 } },
        ],
      },
      ctx,
      outDir()
    );

    const doc = await loadOut(out);
    expect(doc.getPageCount()).toBe(2);
    expect(pageAnnots(doc, 0)).toHaveLength(0);

    const texts = await pageTexts(out);
    expect(texts[0]).toBe("");
    expect(texts[1]).toContain("Page 2");

    // The redaction area is opaque black.
    const [r, g, b] = await samplePixel(out, 0, 150, 90);
    expect(r).toBeLessThan(10);
    expect(g).toBeLessThan(10);
    expect(b).toBeLessThan(10);
  });

  it("drops other annotations on a redacted page but keeps them elsewhere", async () => {
    const out = await runEditorSave(
      {
        filePath: two,
        annotations: [
          { type: "redact", page: 1, rect: { x: 40, y: 60, w: 320, h: 70 } },
          rectAnnot("rect", { x: 100, y: 100, w: 50, h: 50 }, { page: 1 }),
          rectAnnot("rect", { x: 100, y: 100, w: 50, h: 50 }, { page: 2 }),
        ],
      },
      ctx,
      outDir()
    );

    const doc = await loadOut(out);
    // Documented v1 tradeoff: the flattened page drops any co-located annots.
    expect(pageAnnots(doc, 0)).toHaveLength(0);
    const page2 = pageAnnots(doc, 1);
    expect(page2).toHaveLength(1);
    expect(name(page2[0], "Subtype")).toBe("/Square");

    const texts = await pageTexts(out);
    expect(texts[0]).toBe("");
    expect(texts[1]).toContain("Page 2");
  });

  it("still writes ordinary annots when the redact branch is active", async () => {
    const out = await runEditorSave(
      {
        filePath: two,
        annotations: [
          rectAnnot("rect", { x: 10, y: 10, w: 40, h: 40 }, { page: 1 }),
          { type: "redact", page: 2, rect: { x: 40, y: 60, w: 320, h: 70 } },
        ],
      },
      ctx,
      outDir()
    );

    const doc = await loadOut(out);
    expect(pageAnnots(doc, 0)).toHaveLength(1);
    expect(pageAnnots(doc, 1)).toHaveLength(0);
    const texts = await pageTexts(out);
    expect(texts[0]).toContain("Page 1");
    expect(texts[1]).toBe("");
  });

  it("rejects a redact annotation passed straight to writeAnnotations", async () => {
    const doc = await PDFDocument.load(readFileSync(two));
    await expect(
      writeAnnotations(
        doc,
        [rectAnnot("redact", { x: 10, y: 10, w: 20, h: 20 })],
        { cancelled: () => false }
      )
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("rejects a CJK freetext even in the redact branch (WinAnsi)", async () => {
    await expect(
      runEditorSave(
        {
          filePath: two,
          annotations: [
            { type: "redact", page: 1, rect: { x: 40, y: 60, w: 320, h: 70 } },
            rectAnnot("freetext", { x: 10, y: 10, w: 80, h: 20 }, { page: 2, text: "第一頁" }),
          ],
        },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32001 });
  });
});

describe("runEditorSave errors and cancellation", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("editor-errors");
  });

  it("rejects CJK text annotations as INVALID_INPUT, not an internal error", async () => {
    const src = await makePdf(join(dir, "cjk.pdf"), 1);
    await expect(
      runEditorSave(
        {
          filePath: src,
          annotations: [rectAnnot("text", { x: 10, y: 10, w: 80, h: 20 }, { text: "第一頁" })],
        },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("rejects CJK freetext annotations as INVALID_INPUT", async () => {
    const src = await makePdf(join(dir, "cjk-free.pdf"), 1);
    await expect(
      runEditorSave(
        {
          filePath: src,
          annotations: [rectAnnot("freetext", { x: 10, y: 10, w: 80, h: 20 }, { text: "第一頁" })],
        },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runEditorSave(
        {
          filePath: enc,
          annotations: [rectAnnot("rect", { x: 10, y: 10, w: 20, h: 20 })],
        },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32002 });
  });

  it("maps a missing file to CORRUPT_PDF", async () => {
    await expect(
      runEditorSave(
        {
          filePath: join(dir, "missing.pdf"),
          annotations: [rectAnnot("rect", { x: 10, y: 10, w: 20, h: 20 })],
        },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("throws CANCELLED when the job is already cancelled", async () => {
    const src = await makePdf(join(dir, "cancel.pdf"), 1);
    await expect(
      runEditorSave(
        { filePath: src, annotations: [rectAnnot("rect", { x: 10, y: 10, w: 20, h: 20 })] },
        { ...ctx, cancelled: () => true },
        outDir()
      )
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("rejects an empty annotation list at the schema", async () => {
    const src = await makePdf(join(dir, "empty.pdf"), 1);
    await expect(runEditorSave({ filePath: src, annotations: [] }, ctx, outDir())).rejects.toThrow();
  });
});

describe("editor registry", () => {
  it("registers editorSave", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("editorSave")).toBe(true);
  });
});
