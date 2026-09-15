import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureDir, makePdf } from "../../testing/fixtures";
import { buildFromPages } from "./organize";
import { runExtract } from "./extract";
import { runDelete } from "./delete";
import { runReverse } from "./reverse";
import { runRotate, runRotateCustom } from "./rotate";
import { runAddBlankPage } from "./addblank";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

// Source fixture: page i is 100+i wide, so output widths reveal page order
// without text extraction.
const WIDTHS = [100, 101, 102, 103, 104];

async function load(out: string): Promise<PDFDocument> {
  return PDFDocument.load(await readFile(out));
}

function widths(doc: PDFDocument): number[] {
  return doc.getPages().map((p) => p.getWidth());
}

function angles(doc: PDFDocument): number[] {
  return doc.getPages().map((p) => p.getRotation().angle);
}

describe("simple page tools", () => {
  let dir: string;
  let src: string;
  beforeAll(async () => {
    dir = fixtureDir("organize-simple");
    src = await makePdf(join(dir, "five.pdf"), 5, {
      sizes: WIDTHS.map((w) => [w, 100]),
    });
  });

  describe("extract", () => {
    it('keeps only selected pages, named "extracted.pdf"', async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runExtract({ filePath: src, pages: "1-3,5" }, ctx, outDir);
      expect(out).toBe(join(outDir, "extracted.pdf"));
      const doc = await load(out);
      expect(doc.getPageCount()).toBe(4);
      expect(widths(doc)).toEqual([100, 101, 102, 104]);
    });

    it("normalizes selection ascending (5,1-2)", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runExtract({ filePath: src, pages: "5,1-2" }, ctx, outDir);
      expect(widths(await load(out))).toEqual([100, 101, 104]);
    });

    it("dedupes overlapping tokens", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runExtract({ filePath: src, pages: "1-3,2" }, ctx, outDir);
      expect(widths(await load(out))).toEqual([100, 101, 102]);
    });

    it("rejects an out-of-range page", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      await expect(
        runExtract({ filePath: src, pages: "1-6" }, ctx, outDir)
      ).rejects.toMatchObject({ code: -32001 });
    });
  });

  describe("delete", () => {
    it('removes selected pages, preserving order, named "deleted.pdf"', async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runDelete({ filePath: src, pages: "2,4" }, ctx, outDir);
      expect(out).toBe(join(outDir, "deleted.pdf"));
      const doc = await load(out);
      expect(doc.getPageCount()).toBe(3);
      expect(widths(doc)).toEqual([100, 102, 104]);
    });

    it("inverts a multi-page selection", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runDelete({ filePath: src, pages: "1,3,5" }, ctx, outDir);
      expect(widths(await load(out))).toEqual([101, 103]);
    });
  });

  describe("reverse", () => {
    it('reverses all pages, named "reversed.pdf"', async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runReverse({ filePath: src }, ctx, outDir);
      expect(out).toBe(join(outDir, "reversed.pdf"));
      const doc = await load(out);
      expect(doc.getPageCount()).toBe(5);
      expect(widths(doc)).toEqual([104, 103, 102, 101, 100]);
    });
  });

  describe("rotate", () => {
    it("SETs the angle on all pages (absolute, replaces existing)", async () => {
      const rotated = await makePdf(join(dir, "pre-rotated.pdf"), 2, {
        sizes: [
          [100, 100],
          [101, 100],
        ],
        rotations: [90, 0],
      });
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runRotate({ filePath: rotated, angle: 90 }, ctx, outDir);
      expect(out).toBe(join(outDir, "rotated.pdf"));
      const doc = await load(out);
      expect(angles(doc)).toEqual([90, 90]);
    });

    it("SETs only the selected pages to 180", async () => {
      const three = await makePdf(join(dir, "three.pdf"), 3, {
        sizes: [
          [100, 100],
          [101, 100],
          [102, 100],
        ],
      });
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runRotate(
        { filePath: three, angle: 180, pages: "1" },
        ctx,
        outDir
      );
      expect(angles(await load(out))).toEqual([180, 0, 0]);
    });
  });

  describe("rotateCustom", () => {
    it("applies a DELTA to the existing rotation (+90 on 90 → 180)", async () => {
      const pre = await makePdf(join(dir, "delta.pdf"), 1, {
        sizes: [[100, 100]],
        rotations: [90],
      });
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runRotateCustom({ filePath: pre, angle: 90 }, ctx, outDir);
      expect(out).toBe(join(outDir, "rotated-custom.pdf"));
      expect(angles(await load(out))).toEqual([180]);
    });

    it("normalizes a negative delta (-90 on 0 → 270)", async () => {
      const plain = await makePdf(join(dir, "plain.pdf"), 1, { sizes: [[100, 100]] });
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runRotateCustom(
        { filePath: plain, angle: -90 },
        ctx,
        outDir
      );
      expect(angles(await load(out))).toEqual([270]);
    });

    it("applies the delta to every page", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runRotateCustom({ filePath: src, angle: 180 }, ctx, outDir);
      expect(angles(await load(out))).toEqual([180, 180, 180, 180, 180]);
    });

    it("rejects a delta that would produce a non-multiple of 90", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      await expect(
        runRotateCustom({ filePath: src, angle: 45 }, ctx, outDir)
      ).rejects.toMatchObject({ code: -32001 });
    });
  });

  describe("addBlankPage", () => {
    it('inserts a page matching the first page size, named "blank-added.pdf"', async () => {
      const three = await makePdf(join(dir, "blank-match.pdf"), 3, {
        sizes: [
          [100, 100],
          [101, 100],
          [102, 100],
        ],
      });
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runAddBlankPage(
        { filePath: three, position: 2, size: "match" },
        ctx,
        outDir
      );
      expect(out).toBe(join(outDir, "blank-added.pdf"));
      const doc = await load(out);
      expect(doc.getPageCount()).toBe(4);
      expect(widths(doc)).toEqual([100, 101, 100, 102]);
    });

    it("inserts an A4 landscape blank at position 0", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runAddBlankPage(
        { filePath: src, position: 0, size: "a4", orientation: "landscape" },
        ctx,
        outDir
      );
      const doc = await load(out);
      expect(doc.getPageCount()).toBe(6);
      expect(doc.getPage(0).getWidth()).toBeCloseTo(841.89);
      expect(doc.getPage(0).getHeight()).toBeCloseTo(595.28);
      expect(doc.getPage(1).getWidth()).toBe(100);
    });

    it("rejects a position past the end", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      await expect(
        runAddBlankPage({ filePath: src, position: 6, size: "match" }, ctx, outDir)
      ).rejects.toMatchObject({ code: -32001 });
    });

    it("appends when position equals the page count", async () => {
      const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
      const out = await runAddBlankPage(
        { filePath: src, position: 5, size: "a4" },
        ctx,
        outDir
      );
      const doc = await load(out);
      expect(doc.getPageCount()).toBe(6);
      expect(doc.getPage(5).getWidth()).toBeCloseTo(595.28);
      expect(widths(doc).slice(0, 5)).toEqual(WIDTHS);
    });
  });

  describe("buildFromPages bounds", () => {
    it("rejects an out-of-range source index with INVALID_INPUT", async () => {
      const doc = await PDFDocument.create();
      for (const w of WIDTHS) doc.addPage([w, 200]);
      await expect(buildFromPages(doc, [{ index: 99 }])).rejects.toMatchObject({
        code: -32001,
      });
    });

    it("rejects a negative source index with INVALID_INPUT", async () => {
      const doc = await PDFDocument.create();
      doc.addPage([100, 200]);
      await expect(buildFromPages(doc, [{ index: -1 }])).rejects.toMatchObject({
        code: -32001,
      });
    });
  });
});
