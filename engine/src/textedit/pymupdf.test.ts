import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPdfRenderer } from "../render/renderpdf";
import { extractPageText } from "../render/textextract";
import {
  editTextBytes,
  editTextFile,
  findPymupdfAssets,
  getPageWords,
} from "./pymupdf";

/** Scratch roots created by this file, removed in afterAll. */
const scratch: string[] = [];

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pogopdf-textedit-"));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** One page reading "Hello Edit World" at 24pt on A4. */
async function makeEditFixture(path: string): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  page.drawText("Hello Edit World", { x: 72, y: 700, size: 24, font });
  writeFileSync(path, await doc.save());
}

async function pageText(path: string): Promise<string> {
  const renderer = await getPdfRenderer(path);
  try {
    return await extractPageText(await renderer.getPage(0));
  } finally {
    await renderer.close();
  }
}

/**
 * The package's assets are static files in `node_modules`, not a dependency the
 * resolver reaches, so a checkout without the package installed skips loudly
 * rather than failing on an environment gap.
 */
const assets = findPymupdfAssets();
if (!assets) {
  console.warn(
    "[textedit.test] @bentopdf/pymupdf-wasm assets not found, skipping the " +
      "PyMuPDF-backed text-edit tests. Run npm install in the engine workspace."
  );
}

// Pyodide boot plus wheel load measured at ~1.6 s; the first test in a fresh
// worker also pays Vite's transform of the wasm-adjacent assets.
const TIMEOUT = 120_000;

describe.skipIf(!assets)("pymupdf text edit", () => {
  let dir: string;
  let fixture: string;

  beforeAll(async () => {
    dir = outDir();
    fixture = join(dir, "in.pdf");
    await makeEditFixture(fixture);
  });

  it("extracts word geometry with baselines and span fonts", async () => {
    const words = await getPageWords(new Uint8Array(readFileSync(fixture)), 0);
    const edit = words.find((w) => w.text === "Edit");
    expect(edit).toBeDefined();
    expect(edit!.size).toBeCloseTo(24, 0);
    expect(edit!.font).toBe("helv");
    // Baseline sits below the word's top and above its bottom.
    expect(edit!.originY).toBeGreaterThan(edit!.y0);
    expect(edit!.originY).toBeLessThan(edit!.y1);
    expect(edit!.originX).toBeCloseTo(edit!.x0, 1);
    expect(words.map((w) => w.text)).toEqual(["Hello", "Edit", "World"]);
  }, TIMEOUT);

  it("replaces a word via redact-then-insert and loses the old word", async () => {
    const words = await getPageWords(new Uint8Array(readFileSync(fixture)), 0);
    const edit = words.find((w) => w.text === "Edit")!;
    const out = join(dir, "edited.pdf");

    await editTextFile(
      fixture,
      [
        {
          page: 0,
          quad: { x0: edit.x0, y0: edit.y0, x1: edit.x1, y1: edit.y1 },
          newText: "Replacement",
        },
      ],
      out
    );

    const text = await pageText(out);
    expect(text.split(/\s+/)).not.toContain("Edit");
    expect(text.split(/\s+/)).toContain("Replacement");

    // Page geometry is preserved: one page, same A4 size.
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);

    // The replacement keeps the ORIGINAL span baseline, not the quad bottom.
    const after = await getPageWords(new Uint8Array(readFileSync(out)), 0);
    const replacement = after.find((w) => w.text === "Replacement")!;
    expect(replacement.originY).toBeCloseTo(edit.originY, 1);
    expect(replacement.originX).toBeCloseTo(edit.originX, 1);
  }, TIMEOUT);

  it("autofits from the original span size and keeps the baseline", async () => {
    const words = await getPageWords(new Uint8Array(readFileSync(fixture)), 0);
    const edit = words.find((w) => w.text === "Edit")!;

    // A replacement that already fits must not be shrunk, and it must sit on
    // the ORIGINAL span baseline, not the quad bottom (the regression degraded
    // every replacement to 11pt at the quad bottom).
    const shortOut = join(dir, "short.pdf");
    await editTextFile(
      fixture,
      [
        {
          page: 0,
          quad: { x0: edit.x0, y0: edit.y0, x1: edit.x1, y1: edit.y1 },
          newText: "Hi",
        },
      ],
      shortOut
    );
    const shortWords = await getPageWords(
      new Uint8Array(readFileSync(shortOut)),
      0
    );
    const short = shortWords.find((w) => w.text === "Hi");
    expect(short).toBeDefined();
    expect(short!.size).toBeCloseTo(edit.size, 0);
    expect(Math.abs(short!.originX - edit.x0)).toBeLessThanOrEqual(2);
    expect(Math.abs(short!.originY - edit.originY)).toBeLessThanOrEqual(2);

    // "Edited" is longer than the original quad at 24pt, so the autofit shrinks
    // it, but it fits before the 11pt fallback: a size strictly between 11 and
    // 24 proves the shrink started from the captured original size, not 11.
    const longOut = join(dir, "long.pdf");
    await editTextFile(
      fixture,
      [
        {
          page: 0,
          quad: { x0: edit.x0, y0: edit.y0, x1: edit.x1, y1: edit.y1 },
          newText: "Edited",
        },
      ],
      longOut
    );
    const longWords = await getPageWords(new Uint8Array(readFileSync(longOut)), 0);
    const long = longWords.find((w) => w.text === "Edited")!;
    expect(long).toBeDefined();
    expect(long.size).toBeLessThan(edit.size);
    expect(long.size).toBeGreaterThan(11);
    expect(long.x1 - long.x0).toBeLessThanOrEqual(edit.x1 - edit.x0 + 1);
    expect(Math.abs(long.originY - edit.originY)).toBeLessThanOrEqual(2);
  }, TIMEOUT);

  it("round-trips bytes without touching the filesystem", async () => {
    const src = new Uint8Array(readFileSync(fixture));
    const words = await getPageWords(src, 0);
    const edit = words.find((w) => w.text === "Hello")!;
    const out = await editTextBytes(src, [
      {
        page: 0,
        quad: { x0: edit.x0, y0: edit.y0, x1: edit.x1, y1: edit.y1 },
        newText: "Hi",
      },
    ]);
    expect(out.length).toBeGreaterThan(0);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
  }, TIMEOUT);
});
