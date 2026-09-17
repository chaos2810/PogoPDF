import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { fixtureDir } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { registerTools } from "../registry";
import { runTextToPdf } from "./texttopdf";
import { runMarkdownToPdf } from "./markdowntopdf";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-textpdf-"));
}

type TextItem = { str: string; x: number; y: number; height: number };

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

/** Raw pdf.js text items for the first page (positions and glyph heights). */
async function firstPageItems(path: string): Promise<TextItem[]> {
  const renderer = await getPdfRenderer(path);
  try {
    const page = await renderer.getPage(0);
    const { items } = await page.getTextContent();
    const out: TextItem[] = [];
    for (const item of items) {
      if ("str" in item && typeof item.str === "string" && item.str.length > 0) {
        out.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          height: item.height,
        });
      }
    }
    return out;
  } finally {
    await renderer.close();
  }
}

describe("runTextToPdf", () => {
  let dir: string;

  beforeAll(() => {
    dir = fixtureDir("textpdf");
  });

  it("renders blank-line separated paragraphs and names the output after the source", async () => {
    const src = join(dir, "two.txt");
    writeFileSync(src, "Hello\n\nWorld");
    const out = await runTextToPdf({ filePath: src }, ctx, outDir());
    expect(out.endsWith("two.pdf")).toBe(true);

    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toMatchObject({ width: 595.28, height: 841.89 });

    const [page] = await pageTexts(out);
    expect(page).toContain("Hello");
    expect(page).toContain("World");
  });

  it("paginates long text across multiple pages", async () => {
    const paragraph = "The quick brown fox jumps over the lazy dog. ".repeat(8).trim();
    const src = join(dir, "long.txt");
    writeFileSync(src, Array.from({ length: 200 }, () => paragraph).join("\n\n"));
    const out = await runTextToPdf({ filePath: src }, ctx, outDir());

    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it("honours fontSize and margins (glyph height and x offset)", async () => {
    const src = join(dir, "sized.txt");
    writeFileSync(src, "Sized text");

    const withDefaults = await runTextToPdf({ filePath: src }, ctx, outDir());
    const defaultItems = await firstPageItems(withDefaults);
    const defaultText = defaultItems.find((i) => i.str.includes("Sized"));
    expect(defaultText).toBeDefined();
    expect(defaultText!.x).toBeCloseTo(72, 1);
    expect(defaultText!.height).toBeCloseTo(12, 1);

    const custom = await runTextToPdf(
      { filePath: src, fontSize: 20, margins: 40 },
      ctx,
      outDir()
    );
    const doc = await PDFDocument.load(readFileSync(custom));
    expect(doc.getPage(0).getSize()).toMatchObject({ width: 595.28, height: 841.89 });
    const customItems = await firstPageItems(custom);
    const customText = customItems.find((i) => i.str.includes("Sized"));
    expect(customText).toBeDefined();
    expect(customText!.x).toBeCloseTo(40, 1);
    expect(customText!.height).toBeCloseTo(20, 1);
  });

  it("strips a BOM and normalises CRLF without rendering the BOM", async () => {
    const src = join(dir, "crlf.txt");
    writeFileSync(src, "\uFEFFHello\r\n\r\nWorld\r\n");
    const out = await runTextToPdf({ filePath: src }, ctx, outDir());
    const [page] = await pageTexts(out);
    expect(page).toContain("Hello");
    expect(page).toContain("World");
    expect(page).not.toContain("\uFEFF");
  });

  it("throws CORRUPT_PDF for a missing input file", async () => {
    await expect(
      runTextToPdf({ filePath: join(dir, "nope.txt") }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("throws CANCELLED when cancelled before starting", async () => {
    const src = join(dir, "cancel.txt");
    writeFileSync(src, "cancel me");
    await expect(
      runTextToPdf({ filePath: src }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("runMarkdownToPdf", () => {
  let dir: string;

  beforeAll(() => {
    dir = fixtureDir("textpdf");
  });

  it("renders headings, lists, code blocks and quotes as extractable text", async () => {
    const src = join(dir, "doc.md");
    writeFileSync(src, "# Title\n\n- a\n- b\n\n```\nconst x = 1;\n```\n\n> quote\n");
    const out = await runMarkdownToPdf({ filePath: src }, ctx, outDir());
    expect(out.endsWith("doc.pdf")).toBe(true);

    const [page] = await pageTexts(out);
    expect(page).toContain("Title");
    expect(page).toContain("a");
    expect(page).toContain("b");
    expect(page).toContain("const x = 1;");
    expect(page).toContain("quote");
  });

  it("sizes h1 at 1.7x, h2 at 1.4x and h3 at 1.2x the base font", async () => {
    const src = join(dir, "headings.md");
    writeFileSync(src, "# One\n\n## Two\n\n### Three\n\nbody\n");
    const out = await runMarkdownToPdf({ filePath: src, fontSize: 10 }, ctx, outDir());
    const items = await firstPageItems(out);
    const h = (label: string) => items.find((i) => i.str.includes(label))?.height;
    expect(h("One")).toBeCloseTo(17, 1);
    expect(h("Two")).toBeCloseTo(14, 1);
    expect(h("Three")).toBeCloseTo(12, 1);
    expect(h("body")).toBeCloseTo(10, 1);
  });

  it("drops inline styling to plain text (v1)", async () => {
    const src = join(dir, "inline.md");
    writeFileSync(src, "This is **bold** and *italic* and `code`.\n");
    const out = await runMarkdownToPdf({ filePath: src }, ctx, outDir());
    const [page] = await pageTexts(out);
    expect(page).toContain("bold");
    expect(page).toContain("italic");
    expect(page).toContain("code");
  });

  it("breaks a long code block across pages instead of overflowing", async () => {
    const src = join(dir, "longcode.md");
    const lines = Array.from({ length: 120 }, (_, i) => `const line${i} = ${i};`);
    writeFileSync(src, "```\n" + lines.join("\n") + "\n```\n");
    const out = await runMarkdownToPdf({ filePath: src }, ctx, outDir());
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const pages = await pageTexts(out);
    expect(pages.some((p) => p.includes("line0 = 0"))).toBe(true);
    expect(pages.some((p) => p.includes("line119 = 119"))).toBe(true);
  });

  it("strips script content during sanitisation", async () => {
    const src = join(dir, "xss.md");
    writeFileSync(src, "# Safe\n\n<script>alert(1)</script>\n\nvisible text\n");
    const out = await runMarkdownToPdf({ filePath: src }, ctx, outDir());
    const [page] = await pageTexts(out);
    expect(page).toContain("Safe");
    expect(page).toContain("visible text");
    expect(page).not.toContain("alert(1)");
  });

  it("renders table rows as plain lines with pipe separators (v1)", async () => {
    const src = join(dir, "table.md");
    writeFileSync(src, "| name | value |\n| --- | --- |\n| alpha | 1 |\n");
    const out = await runMarkdownToPdf({ filePath: src }, ctx, outDir());
    const [page] = await pageTexts(out);
    expect(page).toContain("name | value");
    expect(page).toContain("alpha | 1");
  });

  it("throws CORRUPT_PDF for a missing input file", async () => {
    await expect(
      runMarkdownToPdf({ filePath: join(dir, "missing.md") }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("throws CANCELLED when cancelled before starting", async () => {
    const src = join(dir, "cancel.md");
    writeFileSync(src, "# cancel");
    await expect(
      runMarkdownToPdf({ filePath: src }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("convert-in registry", () => {
  it("registers textToPdf and markdownToPdf", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("textToPdf")).toBe(true);
    expect(tools.has("markdownToPdf")).toBe(true);
  });
});
