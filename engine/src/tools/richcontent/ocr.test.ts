import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { encryptedPdfBytes, makePdf } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { displayedPageSize } from "../../render/pagegeometry";
import {
  findOcrDataDir,
  ocrWorkerOptions,
  resolveOcrDataDir,
  type OcrLine,
} from "../../render/ocr";
import { registerTools } from "../registry";
import { drawInvisibleLine, notifyDroppedLines, runOcr } from "./ocr";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

/** Scratch roots created by this file, removed in afterAll. */
const scratch: string[] = [];

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pogopdf-ocr-"));
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

/** True when the page's Resources carry at least one image XObject. */
async function hasImageXObject(path: string, pageIndex = 0): Promise<boolean> {
  const doc = await PDFDocument.load(readFileSync(path));
  const resources = doc.getPage(pageIndex).node.Resources();
  if (!(resources instanceof PDFDict)) return false;
  const xobjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!(xobjects instanceof PDFDict)) return false;
  for (const [, ref] of xobjects.entries()) {
    const resolved = doc.context.lookup(ref);
    const dict = resolved instanceof PDFRawStream ? resolved.dict : resolved;
    if (dict instanceof PDFDict && dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) {
      return true;
    }
  }
  return false;
}

/**
 * OCR depends on the vendored traineddata AND on tesseract.js being able to
 * start its wasm worker; when either is missing the suite skips rather than
 * failing on an environment gap. The two conditions are checked together
 * because a missing language file and a worker that cannot initialize fail at
 * the same point (worker creation). The probe uses a short-lived worker.
 */
const dataDir = findOcrDataDir("eng");
let workerReady = false;
if (dataDir) {
  try {
    const probe = await import("tesseract.js");
    const worker = await probe.createWorker("eng", probe.OEM.LSTM_ONLY, {
      langPath: dataDir,
      gzip: false,
      cacheMethod: "none",
    });
    await worker.terminate();
    workerReady = true;
  } catch (e) {
    console.warn(`[ocr.test] tesseract worker could not initialize: ${String(e)}`);
  }
} else {
  console.warn(
    "[ocr.test] OCR language data not found - skipping OCR-backed tests. " +
      "Run engine/scripts/fetch-ocr-data.ps1 to enable them."
  );
}

const skip = !workerReady;

describe("ocr language data", () => {
  it("resolves missing data as a typed UNSUPPORTED_FORMAT", () => {
    expect(findOcrDataDir("zzz_not_a_language")).toBeNull();
    expect(() => resolveOcrDataDir("zzz_not_a_language")).toThrowError(
      expect.objectContaining({ code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT })
    );
  });

  it("stages a traineddata file for every schema language", () => {
    const langs = ["eng", "chi_tra", "chi_sim", "jpn", "kor", "deu", "fra", "spa"];
    const present = langs.filter((lang) => findOcrDataDir(lang) !== null);
    if (!dataDir) {
      // Honest skip: nothing is staged here. The typed-error test above covers
      // the missing-data behavior, so this branch asserts the absent state.
      expect(present).toHaveLength(0);
      return;
    }
    expect(present, `staged: ${present.join(", ")}`).toEqual(langs);
  });
});

/**
 * Offline guard: the worker options must point at an absolute local directory
 * and disable tesseract's disk cache. Replacing globalThis.fetch with a thrower
 * proves the configuration path never reaches the network. The tesseract
 * worker runs in a separate thread whose adapter captures globalThis.fetch,
 * which is why this asserts the config instead of spawning a worker.
 */
describe("ocr offline guard", () => {
  it("resolves local data (or fails typed) without a network fetch", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("NETWORK FETCH ATTEMPTED");
    }) as typeof fetch;
    try {
      if (dataDir) {
        const opts = ocrWorkerOptions("eng");
        expect(isAbsolute(opts.langPath)).toBe(true);
        expect(opts.langPath).not.toMatch(/^https?:/i);
        expect(opts.gzip).toBe(false);
        expect(opts.cacheMethod).toBe("none");
      } else {
        expect(() => resolveOcrDataDir("eng")).toThrowError(
          expect.objectContaining({ code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT })
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe.skipIf(skip)("runOcr", () => {
  let dir: string;

  beforeAll(async () => {
    dir = outDir();
    await makePdf(join(dir, "src.pdf"), 1, { text: "Hello OCR World" });
  });

  it("builds a searchable PDF with an image page and an extractable text layer", async () => {
    const out2 = outDir();
    const out = await runOcr(
      { filePath: join(dir, "src.pdf"), dpi: 150, searchableOutput: true },
      ctx,
      out2
    );
    expect(out).toBe(join(out2, "ocr.pdf"));
    if (typeof out !== "string") throw new Error("expected single output");

    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(1);
    expect(await hasImageXObject(out)).toBe(true);

    const text = (await pageTexts(out)).join(" ");
    expect(text).toContain("Hello");
    expect(text).toContain("OCR");
  });

  it("writes one .txt per page in plain-text mode", async () => {
    const out2 = outDir();
    const out = await runOcr(
      { filePath: join(dir, "src.pdf"), dpi: 150, searchableOutput: false },
      ctx,
      out2
    );
    if (!Array.isArray(out)) throw new Error("expected multi-output");
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(join(out2, "src-1.txt"));
    expect(readFileSync(out[0], "utf8")).toContain("Hello");
  });

  it("OCRs only the selected page", async () => {
    const two = await makePdf(join(dir, "two.pdf"), 2, { text: "Hello OCR World" });
    const out = await runOcr(
      { filePath: two, pages: "1", dpi: 150, searchableOutput: true },
      ctx,
      outDir()
    );
    if (typeof out !== "string") throw new Error("expected single output");
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(1);
  });

  it("sizes the searchable page to the source's displayed dims under /Rotate 90", async () => {
    const rotated = await makePdf(join(dir, "rotated.pdf"), 1, {
      text: "Hello OCR World",
      sizes: [[200, 100]],
      rotations: [90],
    });
    const src = await PDFDocument.load(readFileSync(rotated));
    const { width, height } = src.getPage(0).getSize();
    const expected = displayedPageSize(90, width, height);
    expect(expected).toEqual({ width: 100, height: 200 });

    const out = await runOcr(
      { filePath: rotated, dpi: 150, searchableOutput: true },
      ctx,
      outDir()
    );
    if (typeof out !== "string") throw new Error("expected single output");
    const doc = await PDFDocument.load(readFileSync(out));
    const size = doc.getPage(0).getSize();
    expect(size.width).toBe(expected.width);
    expect(size.height).toBe(expected.height);
  });

  it("throws CANCELLED between pages, after one page completes", async () => {
    const two = await makePdf(join(dir, "cancel.pdf"), 2, { text: "Hello OCR World" });
    let done = 0;
    const events: string[] = [];
    await expect(
      runOcr(
        { filePath: two, dpi: 150, searchableOutput: false },
        {
          ...ctx,
          notifyProgress: (p) => {
            events.push(p.stage);
            if (p.pagesDone === 1) done = 1;
          },
          // The second cancellation check (next iteration) trips only once the
          // first page has actually finished, proving page 1 was processed.
          cancelled: () => done === 1,
        },
        outDir()
      )
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
    expect(done).toBe(1);
    expect(events).toEqual(["recognizing"]);
  });

  it("does not signal dropped lines for a fully encodable page", async () => {
    const out = outDir();
    const events: Array<{ stage: string; pagesDone: number; percent: number }> = [];
    await runOcr(
      { filePath: join(dir, "src.pdf"), dpi: 150, searchableOutput: true },
      { ...ctx, notifyProgress: (p) => events.push({ ...p }) },
      out
    );
    // "Hello OCR World" is fully WinAnsi encodable, so no warning is emitted.
    expect(events.some((e) => e.stage === "ocr.droppedLines")).toBe(false);
    expect(events.at(-1)?.percent).toBe(100);
  });

  it("reports an encrypted input as ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runOcr({ filePath: enc, dpi: 150, searchableOutput: true }, ctx, outDir())
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.ENCRYPTED_PDF });
  });

  it("throws CANCELLED when cancelled at entry", async () => {
    await expect(
      runOcr(
        { filePath: join(dir, "src.pdf"), dpi: 150 },
        { ...ctx, cancelled: () => true },
        outDir()
      )
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
  });
});

describe("notifyDroppedLines", () => {
  it("emits the dropped-lines stage only when the count is positive", () => {
    const none: unknown[] = [];
    notifyDroppedLines({ notifyProgress: (p) => none.push(p) }, 0);
    expect(none).toHaveLength(0);

    const seen: Array<{ stage: string; pagesDone: number; percent: number }> = [];
    notifyDroppedLines({ notifyProgress: (p) => seen.push(p) }, 3);
    expect(seen).toEqual([{ jobId: "", percent: 100, stage: "ocr.droppedLines", pagesDone: 3 }]);
  });
});

describe("drawInvisibleLine", () => {
  function line(text: string, words: Array<[string, number]>): OcrLine {
    return {
      text,
      bbox: { x0: 10, y0: 10, x1: 60, y1: 30 },
      baseline: { x0: 10, y0: 28, x1: 60, y1: 28 },
      words: words.map(([w, x]) => ({
        text: w,
        bbox: { x0: x, y0: 10, x1: x + 20, y1: 30 },
      })),
    };
  }

  it("drops only the unencodable word and keeps the rest of the line", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([200, 100]);
    const lost = drawInvisibleLine(
      page,
      font,
      line("Hello \u4e16\u754c", [
        ["Hello", 10],
        ["\u4e16\u754c", 40],
      ]),
      1,
      100
    );
    expect(lost).toBe(1);

    const path = join(outDir(), "wordlevel.pdf");
    writeFileSync(path, await doc.save());
    const text = (await pageTexts(path)).join("");
    expect(text).toContain("Hello");
    expect(text).not.toContain("\u4e16");
  });

  it("returns 0 and draws every word for a fully encodable line", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([200, 100]);
    const lost = drawInvisibleLine(
      page,
      font,
      line("Hello OCR", [
        ["Hello", 10],
        ["OCR", 40],
      ]),
      1,
      100
    );
    expect(lost).toBe(0);

    const path = join(outDir(), "wordlevel-ok.pdf");
    writeFileSync(path, await doc.save());
    const text = (await pageTexts(path)).join("");
    expect(text).toContain("Hello");
    expect(text).toContain("OCR");
  });
});

describe("ocr registry", () => {
  it("registers ocr", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("ocr")).toBe(true);
  });
});
