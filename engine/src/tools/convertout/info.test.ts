import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDict, PDFDocument, PDFName, rgb } from "pdf-lib";
import { fixtureDir, makePdf } from "../../testing/fixtures";
import { runViewMetadata } from "./viewmetadata";
import { runPageDimensions } from "./pagedimensions";
import { runFixPageSize } from "./fixpagesize";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-test-"));
}

async function makeMetadataPdf(path: string): Promise<string> {
  const doc = await PDFDocument.create();
  doc.setTitle("Test Title");
  doc.setAuthor("Jane");
  doc.setSubject("Subject Line");
  doc.setKeywords(["alpha", "beta"]);
  doc.setCreator("PogoPDF");
  doc.setCreationDate(new Date("2020-01-02T03:04:05Z"));
  doc.setModificationDate(new Date("2021-06-07T08:09:10Z"));
  doc.addPage([595.28, 841.89]);
  doc.addPage([595.28, 841.89]);
  writeFileSync(path, await doc.save());
  return path;
}

/** A page with a rectangle, so the output can be checked for embedded content. */
async function makePdfWithBox(path: string, w: number, h: number): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([w, h]);
  page.drawRectangle({
    x: w * 0.1,
    y: h * 0.1,
    width: w * 0.5,
    height: h * 0.5,
    color: rgb(1, 0, 0),
  });
  writeFileSync(path, await doc.save());
  return path;
}

function hasEmbeddedPage(doc: PDFDocument, index: number): boolean {
  const xobjects = doc
    .getPage(index)
    .node.Resources()
    ?.lookupMaybe(PDFName.XObject, PDFDict);
  return xobjects !== undefined && xobjects.keys().length > 0;
}

describe("runViewMetadata", () => {
  let dir: string;

  beforeAll(() => {
    dir = fixtureDir("convertout-info");
  });

  it("reads the info dictionary as strings and dates as ISO strings", async () => {
    const path = await makeMetadataPdf(join(dir, "metadata.pdf"));
    const data = (await runViewMetadata({ filePath: path }, ctx, outDir())) as Record<
      string,
      unknown
    >;

    expect(data.title).toBe("Test Title");
    expect(data.author).toBe("Jane");
    expect(data.subject).toBe("Subject Line");
    expect(data.keywords).toBe("alpha beta");
    expect(data.creator).toBe("PogoPDF");
    expect(typeof data.producer).toBe("string");
    expect(data.creationDate).toBe("2020-01-02T03:04:05.000Z");
    // pdf-lib rewrites /ModDate to "now" on save, so it round-trips as an
    // ISO string but not the value we set.
    expect(typeof data.modificationDate).toBe("string");
    expect(Number.isNaN(Date.parse(data.modificationDate as string))).toBe(false);
    expect(data.pageCount).toBe(2);
    expect(data.fileSizeBytes).toBe(statSync(path).size);
  });

  it("returns null for absent fields plus page count and file size", async () => {
    const path = await makePdf(join(dir, "untitled.pdf"), 1);
    const data = (await runViewMetadata({ filePath: path }, ctx, outDir())) as Record<
      string,
      unknown
    >;

    expect(data.title).toBeNull();
    expect(data.author).toBeNull();
    expect(data.subject).toBeNull();
    expect(data.keywords).toBeNull();
    expect(data.pageCount).toBe(1);
    expect(data.fileSizeBytes).toBeGreaterThan(0);
  });
});

describe("runPageDimensions", () => {
  let dir: string;

  beforeAll(() => {
    dir = fixtureDir("convertout-info");
  });

  it("reports A4 as 595.28x841.89 pt and 210x297 mm portrait", async () => {
    const path = await makePdf(join(dir, "a4.pdf"), 1);
    const data = (await runPageDimensions({ filePath: path }, ctx, outDir())) as {
      pages: Array<Record<string, unknown>>;
    };

    expect(data.pages).toHaveLength(1);
    const p = data.pages[0];
    expect(p.widthPt).toBeCloseTo(595.28, 2);
    expect(p.heightPt).toBeCloseTo(841.89, 2);
    expect(p.widthMm).toBeCloseTo(210, 1);
    expect(p.heightMm).toBeCloseTo(297, 1);
    expect(p.orientation).toBe("portrait");
    expect(p.rotation).toBe(0);
  });

  it("uses the displayed (rotation-aware) size for orientation", async () => {
    const path = await makePdf(join(dir, "rotated-info.pdf"), 1, {
      sizes: [[595.28, 841.89]],
      rotations: [90],
    });
    const data = (await runPageDimensions({ filePath: path }, ctx, outDir())) as {
      pages: Array<{
        widthPt: number;
        heightPt: number;
        orientation: string;
        rotation: number;
        displayed: { width: number; height: number };
      }>;
    };

    const p = data.pages[0];
    // widthPt/heightPt stay the MediaBox; the displayed box swaps.
    expect(p.widthPt).toBeCloseTo(595.28, 2);
    expect(p.heightPt).toBeCloseTo(841.89, 2);
    expect(p.displayed.width).toBeCloseTo(841.89, 2);
    expect(p.displayed.height).toBeCloseTo(595.28, 2);
    expect(p.orientation).toBe("landscape");
    expect(p.rotation).toBe(90);
  });

  it("returns one entry per page", async () => {
    const path = await makePdf(join(dir, "two-info.pdf"), 2);
    const data = (await runPageDimensions({ filePath: path }, ctx, outDir())) as {
      pages: unknown[];
    };
    expect(data.pages).toHaveLength(2);
  });
});

describe("runFixPageSize", () => {
  let dir: string;

  beforeAll(() => {
    dir = fixtureDir("convertout-info");
  });

  it("scales source content onto an A4 portrait page", async () => {
    const src = await makePdfWithBox(join(dir, "wide.pdf"), 200, 100);
    const out = await runFixPageSize(
      { filePath: src, size: "a4", orientation: "portrait", fit: "scale" },
      ctx,
      outDir()
    );

    expect(out.endsWith("resized.pdf")).toBe(true);
    const doc = await PDFDocument.load(await readFile(out));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 2);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(841.89, 2);
    expect(hasEmbeddedPage(doc, 0)).toBe(true);
  });

  it("pads (centers without upscaling) a small source onto A4", async () => {
    const src = await makePdfWithBox(join(dir, "small.pdf"), 100, 100);
    const out = await runFixPageSize(
      { filePath: src, size: "a4", orientation: "portrait", fit: "pad" },
      ctx,
      outDir()
    );

    const doc = await PDFDocument.load(await readFile(out));
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 2);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(841.89, 2);
    expect(hasEmbeddedPage(doc, 0)).toBe(true);
  });

  it("applies landscape orientation by swapping the target size", async () => {
    const src = await makePdfWithBox(join(dir, "wide2.pdf"), 200, 100);
    const out = await runFixPageSize(
      { filePath: src, size: "a4", orientation: "landscape", fit: "scale" },
      ctx,
      outDir()
    );

    const doc = await PDFDocument.load(await readFile(out));
    expect(doc.getPage(0).getWidth()).toBeCloseTo(841.89, 2);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(595.28, 2);
  });

  it("supports letter, a3, and a5 target sizes", async () => {
    const src = await makePdfWithBox(join(dir, "box.pdf"), 200, 200);
    const cases = [
      { size: "letter", w: 612, h: 792 },
      { size: "a3", w: 841.89, h: 1190.55 },
      { size: "a5", w: 419.53, h: 595.28 },
    ] as const;
    for (const c of cases) {
      const out = await runFixPageSize(
        { filePath: src, size: c.size, orientation: "portrait", fit: "pad" },
        ctx,
        outDir()
      );
      const doc = await PDFDocument.load(await readFile(out));
      expect(doc.getPage(0).getWidth()).toBeCloseTo(c.w, 2);
      expect(doc.getPage(0).getHeight()).toBeCloseTo(c.h, 2);
    }
  });
});
