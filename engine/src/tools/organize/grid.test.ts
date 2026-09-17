import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureDir, makePdf } from "../../testing/fixtures";
import { runNup } from "./nup";
import { runBooklet } from "./booklet";
import { runDivide } from "./divide";
import { runOrganizeGrid } from "./organizegrid";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

async function load(out: string): Promise<PDFDocument> {
  return PDFDocument.load(await readFile(out));
}

function widths(doc: PDFDocument): number[] {
  return doc.getPages().map((p) => p.getWidth());
}

function dims(doc: PDFDocument): Array<[number, number]> {
  return doc.getPages().map((p) => [p.getWidth(), p.getHeight()]);
}

function angles(doc: PDFDocument): number[] {
  return doc.getPages().map((p) => p.getRotation().angle);
}

// Page i is 100+i wide, so output widths reveal page order/identity.
function seq(start: number, n: number): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => [start + i, 100]);
}

describe("grid page tools", () => {
  let dir: string;
  let eight100: string;
  let three100: string;
  let mixed2: string;
  let eightSeq: string;
  let fiveSeq: string;
  let landscape200: string;
  let portrait100x200: string;
  let threeSeq: string;
  let prerotated: string;

  beforeAll(async () => {
    dir = fixtureDir("organize-grid");
    eight100 = await makePdf(join(dir, "eight-100.pdf"), 8, {
      sizes: Array.from({ length: 8 }, () => [100, 100] as [number, number]),
    });
    three100 = await makePdf(join(dir, "three-100.pdf"), 3, {
      sizes: Array.from({ length: 3 }, () => [100, 100] as [number, number]),
    });
    mixed2 = await makePdf(join(dir, "mixed2.pdf"), 2, {
      sizes: [
        [100, 100],
        [50, 200],
      ],
    });
    eightSeq = await makePdf(join(dir, "eight-seq.pdf"), 8, { sizes: seq(100, 8) });
    fiveSeq = await makePdf(join(dir, "five-seq.pdf"), 5, { sizes: seq(100, 5) });
    landscape200 = await makePdf(join(dir, "landscape200.pdf"), 1, {
      sizes: [[200, 100]],
    });
    portrait100x200 = await makePdf(join(dir, "portrait100x200.pdf"), 1, {
      sizes: [[100, 200]],
    });
    threeSeq = await makePdf(join(dir, "three-seq.pdf"), 3, { sizes: seq(100, 3) });
    prerotated = await makePdf(join(dir, "prerotated.pdf"), 3, {
      sizes: seq(100, 3),
      rotations: [90, 180, 0],
    });
  });

  describe("nup", () => {
    it('2x2 on 8 uniform pages â†’ 2 pages, each 2*cw+3*margin, named "nup.pdf"', async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runNup(
        { filePath: eight100, layout: "2x2" },
        ctx,
        outDir
      );
      expect(out).toBe(join(outDir, "nup.pdf"));
      const doc = await load(out);
      // default margin 6: total = 2*100 + 3*6 = 218
      expect(dims(doc)).toEqual([
        [218, 218],
        [218, 218],
      ]);
    });

    it("1x2 on 3 pages â†’ 2 output pages (ceil(3/2))", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runNup(
        { filePath: three100, layout: "1x2" },
        ctx,
        outDir
      );
      const doc = await load(out);
      expect(doc.getPageCount()).toBe(2);
      // 1 col, 2 rows: width = 1*100 + 2*6 = 112; height = 2*100 + 3*6 = 218
      expect(dims(doc)).toEqual([
        [112, 218],
        [112, 218],
      ]);
    });

    it("mixed sizes take the first page's size as the cell unit", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runNup(
        { filePath: mixed2, layout: "2x2" },
        ctx,
        outDir
      );
      const doc = await load(out);
      expect(doc.getPageCount()).toBe(1);
      expect(dims(doc)).toEqual([[218, 218]]);
    });

    it("margin 0 â†’ exact cell multiples (2 cols â†’ 200 wide)", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runNup(
        { filePath: eight100, layout: "2x2", margin: 0 },
        ctx,
        outDir
      );
      const doc = await load(out);
      expect(dims(doc)).toEqual([
        [200, 200],
        [200, 200],
      ]);
    });
  });

  describe("booklet", () => {
    it('8 pages â†’ fold order 8,1,2,7,6,3,4,5, named "booklet.pdf"', async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runBooklet({ filePath: eightSeq }, ctx, outDir);
      expect(out).toBe(join(outDir, "booklet.pdf"));
      const doc = await load(out);
      expect(widths(doc)).toEqual([107, 100, 101, 106, 105, 102, 103, 104]);
    });

    it("5 pages â†’ padded to 8 with blanks of the first page size", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runBooklet({ filePath: fiveSeq }, ctx, outDir);
      const doc = await load(out);
      expect(doc.getPageCount()).toBe(8);
      // padded indices 5,6,7 are blanks (first page width = 100); order [7,0,1,6,5,2,3,4]
      expect(widths(doc)).toEqual([100, 100, 101, 100, 100, 102, 103, 104]);
    });
  });

  describe("divide", () => {
    it('horizontal 200Ã-100 count 2 â†’ 2 pages 100Ã-100, named "divided.pdf"', async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runDivide(
        { filePath: landscape200, direction: "horizontal", count: 2 },
        ctx,
        outDir
      );
      expect(out).toBe(join(outDir, "divided.pdf"));
      const doc = await load(out);
      expect(dims(doc)).toEqual([
        [100, 100],
        [100, 100],
      ]);
    });

    it("vertical 100Ã-200 count 4 â†’ 4 pages 100Ã-50", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runDivide(
        { filePath: portrait100x200, direction: "vertical", count: 4 },
        ctx,
        outDir
      );
      const doc = await load(out);
      expect(dims(doc)).toEqual([
        [100, 50],
        [100, 50],
        [100, 50],
        [100, 50],
      ]);
    });
  });

  describe("organizeGrid", () => {
    it('reorders pages [2,0,1] â†’ widths [102,100,101], named "organized.pdf"', async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runOrganizeGrid(
        { filePath: threeSeq, pages: [{ srcIndex: 2 }, { srcIndex: 0 }, { srcIndex: 1 }] },
        ctx,
        outDir
      );
      expect(out).toBe(join(outDir, "organized.pdf"));
      expect(widths(await load(out))).toEqual([102, 100, 101]);
    });

    it("applies an absolute per-page rotation", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runOrganizeGrid(
        {
          filePath: threeSeq,
          pages: [{ srcIndex: 0 }, { srcIndex: 1, rotate: 90 }, { srcIndex: 2 }],
        },
        ctx,
        outDir
      );
      expect(angles(await load(out))).toEqual([0, 90, 0]);
    });

    it("preserves intrinsic /Rotate when rotate is omitted", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runOrganizeGrid(
        { filePath: prerotated, pages: [{ srcIndex: 0 }, { srcIndex: 1 }, { srcIndex: 2 }] },
        ctx,
        outDir
      );
      expect(angles(await load(out))).toEqual([90, 180, 0]);
    });

    it("applies an absolute rotation, replacing the intrinsic one", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runOrganizeGrid(
        { filePath: prerotated, pages: [{ srcIndex: 0, rotate: 0 }, { srcIndex: 1 }] },
        ctx,
        outDir
      );
      expect(angles(await load(out))).toEqual([0, 180]);
    });

    it("duplicates a page when the same srcIndex repeats", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runOrganizeGrid(
        { filePath: threeSeq, pages: [{ srcIndex: 0 }, { srcIndex: 0 }] },
        ctx,
        outDir
      );
      expect(widths(await load(out))).toEqual([100, 100]);
    });

    it("rejects an out-of-range srcIndex with INVALID_INPUT", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      await expect(
        runOrganizeGrid(
          { filePath: threeSeq, pages: [{ srcIndex: 9 }] },
          ctx,
          outDir
        )
      ).rejects.toMatchObject({ code: -32001 });
    });
  });
});
