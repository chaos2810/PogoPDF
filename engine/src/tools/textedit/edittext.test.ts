import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type { ProgressParams } from "@pogopdf/contracts";
import { encryptedPdfBytes } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { findPymupdfAssets, getPageWords } from "../../textedit/pymupdf";
import { runEditText } from "./edittext";

const scratch: string[] = [];

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pogopdf-edittext-"));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** One 24pt line per array entry, one array per page. */
async function makeDoc(path: string, pages: string[][]): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595.28, 841.89]);
    let y = 700;
    for (const line of lines) {
      page.drawText(line, { x: 72, y, size: 24, font });
      y -= 40;
    }
  }
  writeFileSync(path, await doc.save());
}

/** The unrotated PyMuPDF page-space quad (x, y, w, h) of a word. */
async function quadOf(
  bytes: Uint8Array,
  page: number,
  word: string
): Promise<{ x: number; y: number; w: number; h: number }> {
  const found = (await getPageWords(bytes, page)).find((w) => w.text === word);
  if (!found) throw new Error(`word "${word}" not found on page ${page}`);
  return { x: found.x0, y: found.y0, w: found.x1 - found.x0, h: found.y1 - found.y0 };
}

const ctx = { cancelled: () => false, notifyProgress: () => {} };

async function pageText(path: string, page = 0): Promise<string> {
  const renderer = await getPdfRenderer(path);
  try {
    return await extractPageText(await renderer.getPage(page));
  } finally {
    await renderer.close();
  }
}

/** Dark-pixel count of a rendered page; 0 means nothing was drawn. */
async function inkPixels(path: string, page = 0): Promise<number> {
  const renderer = await getPdfRenderer(path);
  try {
    const canvas = await renderer.renderPage(page, 72);
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) ink++;
    }
    return ink;
  } finally {
    await renderer.close();
  }
}

const assets = findPymupdfAssets();
if (!assets) {
  console.warn(
    "[edittext.test] @bentopdf/pymupdf-wasm assets not found, skipping the " +
      "PyMuPDF-backed editText tests. Run npm install in the engine workspace."
  );
}

const TIMEOUT = 120_000;

describe.skipIf(!assets)("runEditText", () => {
  let dir: string;
  let fixture: string;
  let fixtureBytes: Uint8Array;

  beforeAll(async () => {
    dir = outDir();
    fixture = join(dir, "in.pdf");
    await makeDoc(fixture, [["Hello Edit World"]]);
    fixtureBytes = new Uint8Array(readFileSync(fixture));
  });

  it("replaces one word in place and preserves geometry", async () => {
    const quad = await quadOf(fixtureBytes, 0, "Edit");
    const out = await runEditText(
      { filePath: fixture, edits: [{ page: 1, quad, newText: "Changed" }] },
      ctx,
      outDir()
    );

    const words = (await pageText(out)).split(/\s+/);
    expect(words).toContain("Changed");
    expect(words).not.toContain("Edit");

    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
  }, TIMEOUT);

  it("applies multiple edits on one page and across pages", async () => {
    const multi = join(dir, "multi.pdf");
    await makeDoc(multi, [["Alpha Beta Gamma"], ["Delta Epsilon Zeta"]]);
    const bytes = new Uint8Array(readFileSync(multi));

    const edits = [
      { page: 1, quad: await quadOf(bytes, 0, "Alpha"), newText: "One" },
      { page: 1, quad: await quadOf(bytes, 0, "Gamma"), newText: "Three" },
      { page: 2, quad: await quadOf(bytes, 1, "Epsilon"), newText: "Middle" },
    ];
    const out = await runEditText({ filePath: multi, edits }, ctx, outDir());

    const page0 = (await pageText(out, 0)).split(/\s+/);
    const page1 = (await pageText(out, 1)).split(/\s+/);
    expect(page0).toContain("One");
    expect(page0).toContain("Three");
    expect(page0).not.toContain("Alpha");
    expect(page0).not.toContain("Gamma");
    expect(page1).toContain("Middle");
    expect(page1).not.toContain("Epsilon");
    expect((await PDFDocument.load(readFileSync(out))).getPageCount()).toBe(2);
  }, TIMEOUT);

  it("shrinks a long replacement to fit the original word width", async () => {
    const quad = await quadOf(fixtureBytes, 0, "Edit");
    const before = (await getPageWords(fixtureBytes, 0)).find((w) => w.text === "Edit")!;

    const out = await runEditText(
      {
        filePath: fixture,
        edits: [{ page: 1, quad, newText: "SubstantiallyLonger" }],
      },
      ctx,
      outDir()
    );

    const after = (await getPageWords(new Uint8Array(readFileSync(out)), 0)).find(
      (w) => w.text === "SubstantiallyLonger"
    )!;
    expect(after).toBeDefined();
    expect(after.size).toBeLessThan(before.size);
    expect(after.size).toBeGreaterThan(1);
    expect(after.x1 - after.x0).toBeLessThanOrEqual(quad.w + 1);
  }, TIMEOUT);

  it("inserts CJK through PyMuPDF's bundled font, rendering and extracting it", async () => {
    // Base-14 fonts degrade CJK to placeholder dots, so the wrapper embeds the
    // bundled Droid Sans Fallback font. The probe proved both pdf.js extraction
    // and rasterization see the real glyphs; this locks that in.
    const quad = await quadOf(fixtureBytes, 0, "Edit");
    const out = await runEditText(
      { filePath: fixture, edits: [{ page: 1, quad, newText: "第一章" }] },
      ctx,
      outDir()
    );

    expect((await pageText(out)).replace(/\s+/g, "")).toContain("第一章");
    // A CJK glyph is a dense cluster: well over a base-14 dot placeholder.
    expect(await inkPixels(out)).toBeGreaterThan(50);
  }, TIMEOUT);

  it("rejects a script no bundled font covers with a typed error", async () => {
    const quad = await quadOf(fixtureBytes, 0, "Edit");
    await expect(
      runEditText(
        { filePath: fixture, edits: [{ page: 1, quad, newText: "مرحبا" }] },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT });
  }, TIMEOUT);

  it("reports progress per edit, ending at 100", async () => {
    const multi = join(dir, "progress.pdf");
    await makeDoc(multi, [["Alpha Beta"], ["Gamma Delta"]]);
    const bytes = new Uint8Array(readFileSync(multi));
    const events: ProgressParams[] = [];

    await runEditText(
      {
        filePath: multi,
        edits: [
          { page: 1, quad: await quadOf(bytes, 0, "Alpha"), newText: "A" },
          { page: 2, quad: await quadOf(bytes, 1, "Gamma"), newText: "G" },
        ],
      },
      { cancelled: () => false, notifyProgress: (p) => events.push(p) },
      outDir()
    );

    expect(events.map((e) => e.pagesDone)).toEqual([1, 2]);
    expect(events.at(-1)!.percent).toBe(100);
  }, TIMEOUT);

  it("cancels between edits", async () => {
    const multi = join(dir, "cancel.pdf");
    await makeDoc(multi, [["Alpha Beta"], ["Gamma Delta"]]);
    const bytes = new Uint8Array(readFileSync(multi));
    let cancel = false;

    await expect(
      runEditText(
        {
          filePath: multi,
          edits: [
            { page: 1, quad: await quadOf(bytes, 0, "Alpha"), newText: "A" },
            { page: 2, quad: await quadOf(bytes, 1, "Gamma"), newText: "G" },
          ],
        },
        {
          cancelled: () => cancel,
          // Flipping cancel after the first edit exercises the between-edit seam.
          notifyProgress: () => {
            cancel = true;
          },
        },
        outDir()
      )
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
  }, TIMEOUT);

  it("maps an encrypted input to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "enc.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    const quad = { x: 10, y: 10, w: 40, h: 12 };
    await expect(
      runEditText({ filePath: enc, edits: [{ page: 1, quad, newText: "x" }] }, ctx, outDir())
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.ENCRYPTED_PDF });
  }, TIMEOUT);

  it("maps a missing file to CORRUPT_PDF", async () => {
    await expect(
      runEditText(
        {
          filePath: join(dir, "does-not-exist.pdf"),
          edits: [{ page: 1, quad: { x: 1, y: 1, w: 2, h: 2 }, newText: "x" }],
        },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CORRUPT_PDF });
  });

  it("maps an out-of-range page to INVALID_INPUT", async () => {
    await expect(
      runEditText(
        {
          filePath: fixture,
          edits: [{ page: 5, quad: { x: 1, y: 1, w: 2, h: 2 }, newText: "x" }],
        },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.INVALID_INPUT });
  }, TIMEOUT);
});
