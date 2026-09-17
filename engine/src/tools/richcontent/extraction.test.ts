import { describe, it, expect, afterAll } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { TOOL_ERROR_CODES, type ProgressParams } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { encryptedPdfBytes } from "../../testing/fixtures";
import { runExtractTables } from "./extracttables";
import { runPdfToMarkdown } from "./pdftomarkdown";
import { runPrepareForAi } from "./prepareforai";

const scratch: string[] = [];

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pogopdf-extract-"));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const okCtx: RpcCtx = { cancelled: () => false, notifyProgress: () => {} };

/** 3 rows x 3 columns of positioned text; "Smith, John" carries a comma. */
async function makeGridPdf(path: string, pages = 1): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const cols = [50, 250, 450];
  const rowsY = [750, 710, 670];
  const grid = [
    ["Name", "Age", "City"],
    ["Alice", "30", "Paris"],
    ["Smith, John", "25", "Lyon"],
  ];
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595.28, 841.89]);
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        page.drawText(grid[r][c], { x: cols[c], y: rowsY[r], size: 12, font });
      }
    }
  }
  writeFileSync(path, await doc.save());
  return path;
}

/** Plain prose: one column per line, no table structure. */
async function makeParagraphPdf(path: string): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  page.drawText("First line of a plain paragraph.", { x: 50, y: 750, size: 12, font });
  page.drawText("Second line with more words here.", { x: 50, y: 730, size: 12, font });
  writeFileSync(path, await doc.save());
  return path;
}

/** Page 1: h1 title, body, bold line. Page 2: plain body text. */
async function makeMarkdownPdf(path: string): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p1 = doc.addPage([595.28, 841.89]);
  p1.drawText("Big Title", { x: 50, y: 760, size: 48, font });
  p1.drawText("Body paragraph text.", { x: 50, y: 700, size: 12, font });
  p1.drawText("Bold line here", { x: 50, y: 670, size: 12, font: bold });
  const p2 = doc.addPage([595.28, 841.89]);
  p2.drawText("Page Two Text", { x: 50, y: 760, size: 12, font });
  writeFileSync(path, await doc.save());
  return path;
}

describe("runExtractTables", () => {
  it("writes one csv per page with 3 rows of 3 cells and quotes commas", async () => {
    const dir = outDir();
    const src = await makeGridPdf(join(dir, "grid.pdf"));
    const out = await runExtractTables({ filePath: src, format: "csv" }, okCtx, dir);
    expect(Array.isArray(out)).toBe(true);
    const paths = out as string[];
    expect(paths).toHaveLength(1);
    expect(paths[0].endsWith("grid-1.csv")).toBe(true);

    const rows = parse(readFileSync(paths[0], "utf8"), { trim: true }) as string[][];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(["Name", "Age", "City"]);
    expect(rows[2][0]).toBe("Smith, John");
    expect(readFileSync(paths[0], "utf8")).toContain('"Smith, John"');
  });

  it("writes a single json with page numbers and string[][] rows", async () => {
    const dir = outDir();
    const src = await makeGridPdf(join(dir, "grid.pdf"));
    const out = (await runExtractTables({ filePath: src, format: "json" }, okCtx, dir)) as string;
    expect(out.endsWith("output.json")).toBe(true);
    const data = JSON.parse(readFileSync(out, "utf8"));
    expect(data.pages).toHaveLength(1);
    expect(data.pages[0].page).toBe(1);
    expect(data.pages[0].rows).toHaveLength(3);
    expect(data.pages[0].rows[0]).toEqual(["Name", "Age", "City"]);
    expect(data.pages[0].rows[1]).toEqual(["Alice", "30", "Paris"]);
  });

  it("writes a single markdown pipe table", async () => {
    const dir = outDir();
    const src = await makeGridPdf(join(dir, "grid.pdf"));
    const out = (await runExtractTables({ filePath: src, format: "markdown" }, okCtx, dir)) as string;
    expect(out.endsWith("output.md")).toBe(true);
    const md = readFileSync(out, "utf8");
    expect(md).toContain("| Name | Age | City |");
    expect(md).toContain("| Alice | 30 | Paris |");
    expect(md).toContain("| Smith, John | 25 | Lyon |");
    expect(/^\| -+ \|/m.test(md)).toBe(true);
  });

  it("honours a page selection", async () => {
    const dir = outDir();
    const src = await makeGridPdf(join(dir, "grid-2.pdf"), 2);
    const out = (await runExtractTables(
      { filePath: src, pages: "2", format: "json" },
      okCtx,
      dir
    )) as string;
    const data = JSON.parse(readFileSync(out, "utf8"));
    expect(data.pages).toHaveLength(1);
    expect(data.pages[0].page).toBe(2);
    expect(data.pages[0].rows[0]).toEqual(["Name", "Age", "City"]);
  });

  it("reports plain prose as UNSUPPORTED_FORMAT", async () => {
    const dir = outDir();
    const src = await makeParagraphPdf(join(dir, "prose.pdf"));
    await expect(
      runExtractTables({ filePath: src, format: "csv" }, okCtx, dir)
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT });
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const dir = outDir();
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runExtractTables({ filePath: enc, format: "csv" }, okCtx, dir)
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.ENCRYPTED_PDF });
  });

  it("throws CANCELLED between pages", async () => {
    const dir = outDir();
    const src = await makeGridPdf(join(dir, "cancel.pdf"), 2);
    let checks = 0;
    const events: ProgressParams[] = [];
    const ctx: RpcCtx = {
      cancelled: () => ++checks > 2,
      notifyProgress: (p) => events.push(p),
    };
    await expect(
      runExtractTables({ filePath: src, format: "csv" }, ctx, dir)
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
    expect(events).toHaveLength(1);
  });

  it("reports progress to 100", async () => {
    const dir = outDir();
    const src = await makeGridPdf(join(dir, "progress.pdf"), 2);
    const events: ProgressParams[] = [];
    await runExtractTables(
      { filePath: src, format: "csv" },
      { cancelled: () => false, notifyProgress: (p) => events.push(p) },
      dir
    );
    expect(events.at(-1)?.percent).toBe(100);
  });
});

describe("runPdfToMarkdown", () => {
  it("maps a large title to h1 and keeps body + bold", async () => {
    const dir = outDir();
    const src = await makeMarkdownPdf(join(dir, "doc.pdf"));
    const out = await runPdfToMarkdown({ filePath: src }, okCtx, dir);
    expect(out.endsWith("doc.md")).toBe(true);
    const md = readFileSync(out, "utf8");
    expect(md).toContain("# Big Title");
    expect(md).toContain("Body paragraph text.");
    expect(md).toContain("**Bold line here**");
  });

  it("keeps content from every page", async () => {
    const dir = outDir();
    const src = await makeMarkdownPdf(join(dir, "doc.pdf"));
    const out = await runPdfToMarkdown({ filePath: src }, okCtx, dir);
    const md = readFileSync(out, "utf8");
    expect(md).toContain("Big Title");
    expect(md).toContain("Page Two Text");
  });

  it("honours a page selection", async () => {
    const dir = outDir();
    const src = await makeMarkdownPdf(join(dir, "doc.pdf"));
    const out = await runPdfToMarkdown({ filePath: src, pages: "1" }, okCtx, dir);
    const md = readFileSync(out, "utf8");
    expect(md).toContain("Big Title");
    expect(md).not.toContain("Page Two Text");
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const dir = outDir();
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(runPdfToMarkdown({ filePath: enc }, okCtx, dir)).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.ENCRYPTED_PDF,
    });
  });

  it("throws CANCELLED between pages and reports progress to 100", async () => {
    const dir = outDir();
    const src = await makeMarkdownPdf(join(dir, "cancel.pdf"));
    const events: ProgressParams[] = [];
    const out = await runPdfToMarkdown(
      { filePath: src },
      { cancelled: () => false, notifyProgress: (p) => events.push(p) },
      dir
    );
    expect(out).toBeTruthy();
    expect(events.at(-1)?.percent).toBe(100);

    let checks = 0;
    await expect(
      runPdfToMarkdown(
        { filePath: src },
        { cancelled: () => ++checks > 2, notifyProgress: () => {} },
        dir
      )
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
  });
});

describe("runPrepareForAi", () => {
  it("writes pageCount metadata and non-empty page text", async () => {
    const dir = outDir();
    const src = await makeMarkdownPdf(join(dir, "ai.pdf"));
    const out = await runPrepareForAi({ filePath: src }, okCtx, dir);
    expect(out.endsWith("ai.json")).toBe(true);
    const data = JSON.parse(readFileSync(out, "utf8"));
    expect(data.metadata.pageCount).toBe(2);
    expect(data.pages).toHaveLength(2);
    expect(data.pages[0].page).toBe(1);
    expect(data.pages[0].text.length).toBeGreaterThan(0);
    expect(data.pages[1].page).toBe(2);
    expect(data.pages[1].text.length).toBeGreaterThan(0);
  });

  it("honours a page selection", async () => {
    const dir = outDir();
    const src = await makeMarkdownPdf(join(dir, "ai.pdf"));
    const out = await runPrepareForAi({ filePath: src, pages: "2" }, okCtx, dir);
    const data = JSON.parse(readFileSync(out, "utf8"));
    expect(data.pages).toHaveLength(1);
    expect(data.pages[0].page).toBe(2);
    expect(data.pages[0].text).toContain("Page Two Text");
  });

  it("reports progress to 100", async () => {
    const dir = outDir();
    const src = await makeMarkdownPdf(join(dir, "ai.pdf"));
    const events: ProgressParams[] = [];
    await runPrepareForAi(
      { filePath: src },
      { cancelled: () => false, notifyProgress: (p) => events.push(p) },
      dir
    );
    expect(events.at(-1)?.percent).toBe(100);
  });
});
