import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureDir, makePdf } from "../../testing/fixtures";
import { runSplit } from "./split";
import { runAlternateMix } from "./alternatemix";
import { runDuplexCollate } from "./duplexcollate";
import { runCombineSinglePage, computeLayout } from "./combinesingle";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

async function load(out: string): Promise<PDFDocument> {
  return PDFDocument.load(await readFile(out));
}

function widths(doc: PDFDocument): number[] {
  return doc.getPages().map((p) => p.getWidth());
}

function counts(docs: PDFDocument[]): number[] {
  return docs.map((d) => d.getPageCount());
}

// Sequential widths identify pages without text extraction: page i is 10+start+i.
function seq(start: number, n: number): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => [start + i, 20]);
}

describe("batch page tools", () => {
  let dir: string;
  let eight: string;
  let a3: string;
  let b5: string;
  let a5: string;
  let b3: string;
  let six: string;
  let odd5: string;
  let stack: string;

  beforeAll(async () => {
    dir = fixtureDir("organize-batch");
    eight = await makePdf(join(dir, "eight.pdf"), 8, { sizes: seq(10, 8) });
    a3 = await makePdf(join(dir, "a3.pdf"), 3, { sizes: seq(10, 3) });
    b5 = await makePdf(join(dir, "b5.pdf"), 5, { sizes: seq(20, 5) });
    a5 = await makePdf(join(dir, "a5.pdf"), 5, { sizes: seq(10, 5) });
    b3 = await makePdf(join(dir, "b3.pdf"), 3, { sizes: seq(20, 3) });
    six = await makePdf(join(dir, "six.pdf"), 6, { sizes: seq(10, 6) });
    odd5 = await makePdf(join(dir, "odd5.pdf"), 5, { sizes: seq(10, 5) });
    stack = await makePdf(join(dir, "stack.pdf"), 3, {
      sizes: [
        [100, 200],
        [60, 300],
        [80, 150],
      ],
    });
  });

  describe("split", () => {
    it('ranges: each comma token is one output document, named "{prefix}-{n}.pdf"', async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runSplit(
        { filePath: eight, mode: "ranges", ranges: "1-3,5" },
        ctx,
        outDir
      );
      expect(Array.isArray(out)).toBe(true);
      expect(out).toEqual([
        join(outDir, "eight-1.pdf"),
        join(outDir, "eight-2.pdf"),
      ]);
      const docs = await Promise.all(out.map(load));
      expect(counts(docs)).toEqual([3, 1]);
      expect(widths(docs[0])).toEqual([10, 11, 12]);
      expect(widths(docs[1])).toEqual([14]);
    });

    it("ranges preserve token order, not ascending normalization (5,1-3)", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runSplit(
        { filePath: eight, mode: "ranges", ranges: "5,1-3" },
        ctx,
        outDir
      );
      const docs = await Promise.all(out.map(load));
      expect(counts(docs)).toEqual([1, 3]);
      expect(widths(docs[0])).toEqual([14]);
      expect(widths(docs[1])).toEqual([10, 11, 12]);
    });

    it("honors filePrefix", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runSplit(
        { filePath: eight, mode: "ranges", ranges: "1,2", filePrefix: "myout" },
        ctx,
        outDir
      );
      expect(out).toEqual([
        join(outDir, "myout-1.pdf"),
        join(outDir, "myout-2.pdf"),
      ]);
    });

    it("every: consecutive chunks with a trailing remainder", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out3 = await runSplit(
        { filePath: eight, mode: "every", every: 3 },
        ctx,
        outDir
      );
      expect(counts(await Promise.all(out3.map(load)))).toEqual([3, 3, 2]);

      const out2 = await runSplit(
        { filePath: eight, mode: "every", every: 2 },
        ctx,
        mkdtempSync(join(tmpdir(), "pogopdf-test-"))
      );
      expect(counts(await Promise.all(out2.map(load)))).toEqual([2, 2, 2, 2]);
    });

    it("single: one file per page", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runSplit({ filePath: eight, mode: "single" }, ctx, outDir);
      expect(out).toHaveLength(8);
      expect(out[0]).toBe(join(outDir, "eight-1.pdf"));
      expect(out[7]).toBe(join(outDir, "eight-8.pdf"));
      expect(counts(await Promise.all(out.map(load)))).toEqual([
        1, 1, 1, 1, 1, 1, 1, 1,
      ]);
    });

    it("rejects mode=ranges without ranges", async () => {
      await expect(
        runSplit(
          { filePath: eight, mode: "ranges" },
          ctx,
          mkdtempSync(join(tmpdir(), "pogopdf-test-"))
        )
      ).rejects.toMatchObject({ code: -32001 });
    });

    it("rejects an empty ranges spec", async () => {
      await expect(
        runSplit(
          { filePath: eight, mode: "ranges", ranges: "  " },
          ctx,
          mkdtempSync(join(tmpdir(), "pogopdf-test-"))
        )
      ).rejects.toMatchObject({ code: -32001 });
    });

    it("rejects mode=every without every", async () => {
      await expect(
        runSplit(
          { filePath: eight, mode: "every" },
          ctx,
          mkdtempSync(join(tmpdir(), "pogopdf-test-"))
        )
      ).rejects.toMatchObject({ code: -32001 });
    });

    it("rejects an out-of-range range", async () => {
      await expect(
        runSplit(
          { filePath: eight, mode: "ranges", ranges: "1-9" },
          ctx,
          mkdtempSync(join(tmpdir(), "pogopdf-test-"))
        )
      ).rejects.toMatchObject({ code: -32001 });
    });
  });

  describe("alternateMix", () => {
    it('alternate zips A and B, appending the longer tail (A=3, B=5) as "alternated.pdf"', async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runAlternateMix(
        { filePaths: [a3, b5], order: "alternate" },
        ctx,
        outDir
      );
      expect(out).toBe(join(outDir, "alternated.pdf"));
      expect(widths(await load(out))).toEqual([10, 20, 11, 21, 12, 22, 23, 24]);
    });

    it("inverse interleaves A ascending with B descending, appending B's tail in that direction", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runAlternateMix(
        { filePaths: [a3, b5], order: "inverse" },
        ctx,
        outDir
      );
      expect(widths(await load(out))).toEqual([10, 24, 11, 23, 12, 22, 21, 20]);
    });

    it("alternate with A longer appends A's tail (A=5, B=3)", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runAlternateMix(
        { filePaths: [a5, b3], order: "alternate" },
        ctx,
        outDir
      );
      expect(widths(await load(out))).toEqual([10, 20, 11, 21, 12, 22, 13, 14]);
    });

    it("inverse with A longer appends A ascending (A=5, B=3)", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runAlternateMix(
        { filePaths: [a5, b3], order: "inverse" },
        ctx,
        outDir
      );
      expect(widths(await load(out))).toEqual([10, 22, 11, 21, 12, 20, 13, 14]);
    });
  });

  describe("duplexCollate", () => {
    it('interleaves fronts ascending with backs descending as "collated.pdf"', async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runDuplexCollate({ filePath: six }, ctx, outDir);
      expect(out).toBe(join(outDir, "collated.pdf"));
      // 6 pages: fronts 1,2,3 backs (reversed) 6,5,4 → 1,6,2,5,3,4.
      expect(widths(await load(out))).toEqual([10, 15, 11, 14, 12, 13]);
    });

    it("rejects an odd page count", async () => {
      await expect(
        runDuplexCollate(
          { filePath: odd5 },
          ctx,
          mkdtempSync(join(tmpdir(), "pogopdf-test-"))
        )
      ).rejects.toMatchObject({ code: -32001 });
    });
  });

  describe("combineSinglePage", () => {
    it('vertical: width = max, height = sum, named "combined.pdf"', async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runCombineSinglePage(
        { filePath: stack, direction: "vertical", align: "center" },
        ctx,
        outDir
      );
      expect(out).toBe(join(outDir, "combined.pdf"));
      const doc = await load(out);
      expect(doc.getPageCount()).toBe(1);
      expect(doc.getPage(0).getWidth()).toBe(100);
      expect(doc.getPage(0).getHeight()).toBe(650);
    });

    it("horizontal: width = sum, height = max", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runCombineSinglePage(
        { filePath: stack, direction: "horizontal", align: "start" },
        ctx,
        outDir
      );
      const doc = await load(out);
      expect(doc.getPage(0).getWidth()).toBe(240);
      expect(doc.getPage(0).getHeight()).toBe(300);
    });
  });

  describe("computeLayout", () => {
    const pages = [
      { width: 100, height: 200 },
      { width: 60, height: 300 },
      { width: 80, height: 150 },
    ];

    it("vertical stacks top-to-bottom, aligning each page on the cross axis", () => {
      const start = computeLayout(pages, "vertical", "start");
      expect(start).toEqual({
        width: 100,
        height: 650,
        positions: [
          { x: 0, y: 450 },
          { x: 0, y: 150 },
          { x: 0, y: 0 },
        ],
      });
      const center = computeLayout(pages, "vertical", "center");
      expect(center).toEqual({
        width: 100,
        height: 650,
        positions: [
          { x: 0, y: 450 },
          { x: 20, y: 150 },
          { x: 10, y: 0 },
        ],
      });
      const end = computeLayout(pages, "vertical", "end");
      expect(end.positions).toEqual([
        { x: 0, y: 450 },
        { x: 40, y: 150 },
        { x: 20, y: 0 },
      ]);
    });

    it("horizontal lays out left-to-right, aligning each page on the cross axis", () => {
      const start = computeLayout(pages, "horizontal", "start");
      expect(start).toEqual({
        width: 240,
        height: 300,
        positions: [
          { x: 0, y: 100 },
          { x: 100, y: 0 },
          { x: 160, y: 150 },
        ],
      });
      const center = computeLayout(pages, "horizontal", "center");
      expect(center.positions).toEqual([
        { x: 0, y: 50 },
        { x: 100, y: 0 },
        { x: 160, y: 75 },
      ]);
      const end = computeLayout(pages, "horizontal", "end");
      expect(end.positions).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 160, y: 0 },
      ]);
    });
  });
});
