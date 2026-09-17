import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { fixtureDir } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { registerTools } from "../registry";
import { runCsvToPdf } from "./csvtopdf";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-csvpdf-"));
}

/** Per-page extracted text via the real pdf.js renderer. */
async function pageTexts(path: string): Promise<string[]> {
  const renderer = await getPdfRenderer(path);
  try {
    const pages: string[] = [];
    for (let i = 0; i < renderer.pageCount; i++) {
      pages.push(await extractPageText(await renderer.getPage(i)));
    }
    return pages;
  } finally {
    await renderer.close();
  }
}

/**
 * Count pixels in a horizontal band whose channels all sit in [lo, hi]. Rendered
 * at 72 dpi so canvas rows map 1:1 onto PDF points measured from the page top
 * (the same origin pdfkit draws with).
 */
async function bandPixels(
  path: string,
  yTop: number,
  height: number,
  lo: number,
  hi: number
): Promise<number> {
  const renderer = await getPdfRenderer(path);
  try {
    const canvas = await renderer.renderPage(0, 72);
    const { data } = canvas.getContext("2d").getImageData(0, yTop, canvas.width, height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r >= lo && r <= hi && g >= lo && g <= hi && b >= lo && b <= hi) count++;
    }
    return count;
  } finally {
    await renderer.close();
  }
}

describe("runCsvToPdf", () => {
  let dir: string;

  beforeAll(() => {
    dir = fixtureDir("csvpdf");
  });

  it("renders the header row and every cell as extractable text", async () => {
    const src = join(dir, "grid.csv");
    writeFileSync(src, "name,age,city\nalpha,30,Oslo\nbeta,40,Lima\n");
    const out = await runCsvToPdf({ filePath: src }, ctx, outDir());
    expect(out.endsWith("grid.pdf")).toBe(true);

    const [page] = await pageTexts(out);
    for (const token of ["name", "age", "city", "alpha", "30", "Oslo", "beta", "40", "Lima"]) {
      expect(page).toContain(token);
    }
  });

  it("draws a gray header band and stripes alternate data rows", async () => {
    const src = join(dir, "styled.csv");
    writeFileSync(src, "name,age,city\nalpha,30,Oslo\nbeta,40,Lima\n");
    const out = await runCsvToPdf({ filePath: src }, ctx, outDir());

    // Header row at y=36..52, first data row 52..68 (white), second 68..84 (striped).
    const headerBand = await bandPixels(out, 36, 16, 200, 240); // #d9d9d9 = 217
    expect(headerBand).toBeGreaterThan(200);

    const stripeBand = await bandPixels(out, 68, 16, 240, 253); // #f7f7f7 = 247
    expect(stripeBand).toBeGreaterThan(200);

    const plainBand = await bandPixels(out, 52, 16, 240, 253);
    expect(plainBand).toBeLessThan(stripeBand);
  });

  it("lays the page out in landscape when asked", async () => {
    const src = join(dir, "wide.csv");
    writeFileSync(src, "a,b\n1,2\n");

    const portrait = await runCsvToPdf({ filePath: src }, ctx, outDir());
    const portraitDoc = await PDFDocument.load(readFileSync(portrait));
    expect(portraitDoc.getPage(0).getSize()).toMatchObject({ width: 595.28, height: 841.89 });

    const landscape = await runCsvToPdf(
      { filePath: src, orientation: "landscape" },
      ctx,
      outDir()
    );
    const landscapeDoc = await PDFDocument.load(readFileSync(landscape));
    const size = landscapeDoc.getPage(0).getSize();
    expect(size.width).toBeCloseTo(841.89, 2);
    expect(size.height).toBeCloseTo(595.28, 2);
  });

  it("paginates many rows and repeats the header on each page", async () => {
    const rows = Array.from({ length: 60 }, (_, i) => `row${i},value${i}`);
    const src = join(dir, "many.csv");
    writeFileSync(src, ["colAlpha,colBeta", ...rows].join("\n"));

    const out = await runCsvToPdf({ filePath: src }, ctx, outDir());
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBeGreaterThan(1);

    const pages = await pageTexts(out);
    expect(pages[0]).toContain("colAlpha");
    expect(pages[1]).toContain("colAlpha");
    expect(pages[0]).toContain("row0");
    expect(pages[1]).toContain("row59");
  });

  it("clips cell text that is wider than its column instead of overflowing", async () => {
    const overflow = "START" + "X".repeat(600) + "ENDTAIL";
    const src = join(dir, "clip.csv");
    writeFileSync(src, `shortcol,longcol\nv1,"${overflow}"\n`);

    const out = await runCsvToPdf({ filePath: src }, ctx, outDir());
    const [page] = await pageTexts(out);
    expect(page).not.toContain("ENDTAIL");
    expect(page).not.toContain("X".repeat(600));
  });

  it("normalises ragged rows to the header's column count", async () => {
    const src = join(dir, "ragged.csv");
    writeFileSync(src, "a,b,c\n1\n4,5,6,7\n");
    const out = await runCsvToPdf({ filePath: src }, ctx, outDir());
    const [page] = await pageTexts(out);
    expect(page).toContain("1");
    expect(page).toContain("4");
    expect(page).toContain("5");
    expect(page).toContain("6");
    // The extra 4th cell is dropped in v1.
    expect(page).not.toContain("7");
  });

  it("throws INVALID_INPUT with row info for malformed CSV", async () => {
    const src = join(dir, "broken.csv");
    writeFileSync(src, 'a,b\n"unclosed,2\n');
    await expect(runCsvToPdf({ filePath: src }, ctx, outDir())).rejects.toMatchObject({
      code: -32001,
      message: expect.stringMatching(/line/i),
    });
  });

  it("throws CORRUPT_PDF for a missing input file", async () => {
    await expect(
      runCsvToPdf({ filePath: join(dir, "nope.csv") }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("throws CANCELLED when cancelled before starting", async () => {
    const src = join(dir, "cancel.csv");
    writeFileSync(src, "a,b\n1,2\n");
    await expect(
      runCsvToPdf({ filePath: src }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("convert-in registry", () => {
  it("registers textToPdf, markdownToPdf and csvToPdf", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("textToPdf")).toBe(true);
    expect(tools.has("markdownToPdf")).toBe(true);
    expect(tools.has("csvToPdf")).toBe(true);
  });
});
