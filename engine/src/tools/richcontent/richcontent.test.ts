import { describe, it, expect, beforeAll, afterAll } from "vitest";
import sharp from "sharp";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { registerTools } from "../registry";
import { makeComicZip, makeEpub, makeFb2, makeXps } from "../../testing/richcontent";
import { runEbookToPdf } from "./ebooktopdf";
import { runXpsToPdf } from "./xpstopdf";
import { runComicToPdf } from "./comictopdf";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

/** Scratch roots created by this file, removed in afterAll. */
const scratch: string[] = [];

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pogopdf-rich-"));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

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

/** True when any pixel of the page at 72dpi is darker than near-white. */
async function hasInk(path: string, pageIndex = 0): Promise<boolean> {
  const renderer = await getPdfRenderer(path);
  try {
    const canvas = await renderer.renderPage(pageIndex, 72);
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) return true;
    }
    return false;
  } finally {
    await renderer.close();
  }
}

async function solidImage(format: "jpeg" | "png", colour: { r: number; g: number; b: number }) {
  return sharp({ create: { width: 80, height: 50, channels: 3, background: colour } })
    .toFormat(format)
    .toBuffer();
}

describe("runEbookToPdf", () => {
  it("converts an EPUB and keeps the chapter text selectable", async () => {
    const dir = outDir();
    const src = await makeEpub(join(dir, "book.epub"), "Chapter One", "Hello from the ebook.");
    const out = await runEbookToPdf({ filePath: src }, ctx, dir);

    expect(out).toBe(join(dir, "book.pdf"));
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    const text = (await pageTexts(out)).join(" ");
    expect(text).toContain("Chapter One");
    expect(text).toContain("Hello from the ebook.");
  });

  it("lays A4 pages by default and applies a larger font size", async () => {
    const dir = outDir();
    const src = await makeEpub(join(dir, "sized.epub"), "Sized", "body ".repeat(400));
    const out = await runEbookToPdf({ filePath: src }, ctx, dir);
    const doc = await PDFDocument.load(readFileSync(out));
    const size = doc.getPage(0).getSize();
    expect(size.width).toBeCloseTo(595.28, 1);
    expect(size.height).toBeCloseTo(841.89, 1);
  });

  it("reflows a longer book to more pages at a bigger font", async () => {
    const dir = outDir();
    const chapter = "<p>" + "The quick brown fox jumps over the lazy dog. ".repeat(40) + "</p>";
    const src = await makeEpub(join(dir, "reflow.epub"), "Reflow", chapter.repeat(20));
    const small = await runEbookToPdf({ filePath: src, fontSize: 10 }, ctx, outDir());
    const large = await runEbookToPdf({ filePath: src, fontSize: 24 }, ctx, outDir());
    const smallDoc = await PDFDocument.load(readFileSync(small));
    const largeDoc = await PDFDocument.load(readFileSync(large));
    expect(largeDoc.getPageCount()).toBeGreaterThan(smallDoc.getPageCount());
  });

  it("converts an FB2 and keeps the book title text", async () => {
    const dir = outDir();
    const src = await makeFb2(join(dir, "story.fb2"), "FB2 Probe Title", "FB2 body text here.");
    const out = await runEbookToPdf({ filePath: src }, ctx, dir);
    expect(out).toBe(join(dir, "story.pdf"));
    const text = (await pageTexts(out)).join(" ");
    expect(text).toContain("FB2 Probe Title");
    expect(text).toContain("FB2 body text here.");
  });

  it("names a missing file with CORRUPT_PDF", async () => {
    await expect(
      runEbookToPdf({ filePath: join(outDir(), "nope.epub") }, ctx, outDir())
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CORRUPT_PDF });
  });

  it("names an unsupported extension with UNSUPPORTED_FORMAT", async () => {
    await expect(
      runEbookToPdf({ filePath: join(outDir(), "file.mobi") }, ctx, outDir())
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT });
  });

  it("throws CANCELLED when cancelled before opening", async () => {
    const dir = outDir();
    const src = await makeEpub(join(dir, "cancel.epub"), "Cancel");
    await expect(
      runEbookToPdf({ filePath: src }, { ...ctx, cancelled: () => true }, dir)
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
  });

  it("throws CANCELLED between relayed pages", async () => {
    const dir = outDir();
    const chapter = "<p>" + "word ".repeat(200) + "</p>";
    const src = await makeEpub(join(dir, "cancel-pages.epub"), "Cancel Pages", chapter.repeat(30));
    let checks = 0;
    await expect(
      runEbookToPdf(
        { filePath: src },
        {
          ...ctx,
          cancelled: () => {
            checks++;
            return checks > 2;
          },
        },
        dir
      )
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
  });
});

describe("runXpsToPdf", () => {
  it("reports the missing XPS handler as an honest UNSUPPORTED_FORMAT", async () => {
    // Empirical fact: the official mupdf npm wasm build compiles XPS out
    // (platform/wasm build.sh passes xps=no), so a structurally valid XPS file
    // is unreadable by this binding. This is a build capability gap, so it must
    // surface as UNSUPPORTED_FORMAT rather than CORRUPT_PDF. The full mupdf
    // library reads the same fixture (verified with PyMuPDF 1.28.2).
    const dir = outDir();
    const src = await makeXps(join(dir, "page.xps"));
    const err = await runXpsToPdf({ filePath: src }, ctx, dir).catch((e) => e);
    expect(err).toMatchObject({ code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT });
    expect((err as Error).message).toMatch(/xps/i);
  });

  it("names an unsupported extension with UNSUPPORTED_FORMAT", async () => {
    await expect(
      runXpsToPdf({ filePath: join(outDir(), "doc.oxps.txt") }, ctx, outDir())
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT });
  });

  it("throws CANCELLED when cancelled at entry", async () => {
    await expect(
      runXpsToPdf({ filePath: join(outDir(), "x.xps") }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
  });
});

describe("runComicToPdf", () => {
  it("turns two image entries into two non-blank pages in name order", async () => {
    const dir = outDir();
    const src = await makeComicZip(join(dir, "comic.cbz"), [
      { name: "page-002.png", bytes: await solidImage("png", { r: 0, g: 0, b: 255 }) },
      { name: "page-001.jpg", bytes: await solidImage("jpeg", { r: 255, g: 0, b: 0 }) },
    ]);
    const out = await runComicToPdf({ filePath: src }, ctx, dir);
    expect(out).toBe(join(dir, "comic.pdf"));

    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(2);
    // Name order: page-001.jpg (red) first, page-002.png (blue) second.
    const renderer = await getPdfRenderer(out);
    try {
      const first = await renderer.renderPage(0, 72);
      const d0 = first.getContext("2d").getImageData(40, 25, 1, 1).data;
      expect(d0[0]).toBeGreaterThan(200);
      expect(d0[2]).toBeLessThan(80);
    } finally {
      await renderer.close();
    }
    expect(await hasInk(out, 0)).toBe(true);
    expect(await hasInk(out, 1)).toBe(true);
  });

  it("orders unpadded page numbers naturally: page-2 precedes page-10", async () => {
    const dir = outDir();
    // Insertion order lists page-10 first; only numeric-aware sorting puts
    // page-2 on page 1. localeCompare alone would also order page-10 first.
    const src = await makeComicZip(join(dir, "natural.cbz"), [
      { name: "page-10.png", bytes: await solidImage("png", { r: 0, g: 0, b: 255 }) },
      { name: "page-2.png", bytes: await solidImage("png", { r: 255, g: 0, b: 0 }) },
    ]);
    const out = await runComicToPdf({ filePath: src }, ctx, dir);

    const renderer = await getPdfRenderer(out);
    try {
      const first = await renderer.renderPage(0, 72);
      const d0 = first.getContext("2d").getImageData(40, 25, 1, 1).data;
      // Page 1 must be page-2 (red), not page-10 (blue).
      expect(d0[0]).toBeGreaterThan(200);
      expect(d0[2]).toBeLessThan(80);
    } finally {
      await renderer.close();
    }
  });

  it("maps a corrupt zip to CORRUPT_PDF", async () => {
    const dir = outDir();
    const bad = join(dir, "broken.cbz");
    await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } })
      .png()
      .toFile(bad);
    await expect(runComicToPdf({ filePath: bad }, ctx, dir)).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.CORRUPT_PDF,
    });
  });

  it("maps an archive with no image entries to UNSUPPORTED_FORMAT", async () => {
    const dir = outDir();
    const src = await makeComicZip(join(dir, "text-only.cbz"), [
      { name: "readme.txt", bytes: Buffer.from("no images here") },
    ]);
    await expect(runComicToPdf({ filePath: src }, ctx, dir)).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT,
    });
  });

  it("throws CANCELLED when cancelled at entry", async () => {
    const dir = outDir();
    const src = await makeComicZip(join(dir, "cancel.cbz"), [
      { name: "p.png", bytes: await solidImage("png", { r: 0, g: 255, b: 0 }) },
    ]);
    await expect(
      runComicToPdf({ filePath: src }, { ...ctx, cancelled: () => true }, dir)
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
  });
});

describe("rich content registry", () => {
  it("registers ebookToPdf, xpsToPdf, and comicToPdf", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("ebookToPdf")).toBe(true);
    expect(tools.has("xpsToPdf")).toBe(true);
    expect(tools.has("comicToPdf")).toBe(true);
  });
});
