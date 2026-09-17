import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { encryptedPdfBytes, makePdf } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { findOcrDataDir, resolveOcrDataDir } from "../../render/ocr";
import { registerTools } from "../registry";
import { runOcr } from "./ocr";

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
    if (skip) return;
    for (const lang of ["eng", "chi_tra", "chi_sim", "jpn", "kor", "deu", "fra", "spa"]) {
      expect(findOcrDataDir(lang), lang).not.toBeNull();
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

  it("throws CANCELLED between pages", async () => {
    const two = await makePdf(join(dir, "cancel.pdf"), 2, { text: "Hello OCR World" });
    let checks = 0;
    await expect(
      runOcr(
        { filePath: two, dpi: 150, searchableOutput: false },
        {
          ...ctx,
          cancelled: () => {
            checks++;
            return checks > 1;
          },
        },
        outDir()
      )
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
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

describe("ocr registry", () => {
  it("registers ocr", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("ocr")).toBe(true);
  });
});
