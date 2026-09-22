import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { encryptedPdfBytes } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { findGswin } from "./gsbin";
import { buildPdfAArgs, runPdfToPdfA } from "./pdftoa";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

/** One text page built with pdf-lib (a real embedded Helvetica font). */
async function makeTextPdf(path: string): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont("Helvetica");
  const page = doc.addPage([595.28, 841.89]);
  page.drawText("Hello PDF/A", { x: 50, y: 750, size: 24, font });
  writeFileSync(path, await doc.save());
  return path;
}

const scratch: string[] = [];

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pogopdf-pdftoa-"));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const gsBin = findGswin();
if (!gsBin) {
  console.warn(
    "[pdftoa.test] gswin64c.exe not found - skipping Ghostscript-backed tests. " +
      "Run engine/scripts/fetch-ghostscript.ps1 to enable them."
  );
}

const TIMEOUT = 120_000;

describe("buildPdfAArgs", () => {
  it("maps 1b/2b/3b to -dPDFA=1/2/3", () => {
    for (const [version, n] of [["1b", "1"], ["2b", "2"], ["3b", "3"]] as const) {
      expect(buildPdfAArgs(version, "def.ps", "in.pdf", "out.pdf")).toContain(`-dPDFA=${n}`);
    }
  });

  it("carries the compatibility policy, RGB strategy, pdfwrite device and the def prefix", () => {
    const args = buildPdfAArgs("2b", "def.ps", "in.pdf", "out.pdf");
    expect(args).toContain("-dPDFACompatibilityPolicy=1");
    expect(args).toContain("-sColorConversionStrategy=RGB");
    expect(args).toContain("-sDEVICE=pdfwrite");
    expect(args).toContain("-dNOPAUSE");
    expect(args).toContain("-dBATCH");
    expect(args).toContain("-sOutputFile=out.pdf");
    // The prefix file is an interpreter input before the source PDF.
    expect(args.indexOf("def.ps")).toBeLessThan(args.indexOf("in.pdf"));
  });
});

describe.skipIf(!gsBin)("runPdfToPdfA", () => {
  let dir: string;
  let src: string;

  beforeAll(async () => {
    dir = outDir();
    src = await makeTextPdf(join(dir, "src.pdf"));
  });

  it("writes pdfa.pdf whose catalog carries /OutputIntents and which renders non-blank", async () => {
    const out = await runPdfToPdfA({ filePath: src, pdfaVersion: "2b" }, ctx, outDir());
    expect(out.endsWith("pdfa.pdf")).toBe(true);
    expect(existsSync(out)).toBe(true);

    const doc = await PDFDocument.load(readFileSync(out), { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
    expect(doc.catalog.get(PDFName.of("OutputIntents"))).toBeDefined();

    const renderer = await getPdfRenderer(out);
    try {
      const canvas = await renderer.renderPage(0, 72);
      const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++;
      expect(dark).toBeGreaterThan(0);
    } finally {
      await renderer.close();
    }
  }, TIMEOUT);

  it("declares the pdfaid part and B conformance in the XMP metadata", async () => {
    const out = await runPdfToPdfA({ filePath: src, pdfaVersion: "2b" }, ctx, outDir());
    const text = readFileSync(out).toString("latin1");
    expect(text).toMatch(/pdfaid:part=['"]2['"]/);
    expect(text).toMatch(/pdfaid:conformance=['"]B['"]/);
  }, TIMEOUT);

  it("produces the requested part for each version", async () => {
    for (const [version, part] of [["1b", "1"], ["2b", "2"], ["3b", "3"]] as const) {
      const out = await runPdfToPdfA({ filePath: src, pdfaVersion: version }, ctx, outDir());
      const doc = await PDFDocument.load(readFileSync(out), { updateMetadata: false });
      expect(doc.catalog.get(PDFName.of("OutputIntents")), version).toBeDefined();
      expect(readFileSync(out).toString("latin1"), version).toMatch(
        new RegExp(`pdfaid:part=['"]${part}['"]`)
      );
    }
  }, TIMEOUT);

  it("preserves the page text", async () => {
    const out = await runPdfToPdfA({ filePath: src, pdfaVersion: "2b" }, ctx, outDir());
    const renderer = await getPdfRenderer(out);
    try {
      expect(await extractPageText(await renderer.getPage(0))).toContain("Hello PDF/A");
    } finally {
      await renderer.close();
    }
  }, TIMEOUT);

  it("maps an encrypted input to ENCRYPTED_PDF", async () => {
    // Ghostscript reports the password error on stdout/stderr yet still exits 0
    // with a blank output, so the wrapper must inspect the report rather than
    // trust the exit code. Verified against gs 10.08.0.
    const enc = join(outDir(), "enc.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runPdfToPdfA({ filePath: enc, pdfaVersion: "2b" }, ctx, outDir())
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.ENCRYPTED_PDF });
  }, TIMEOUT);

  it("removes its PDF/A definition prefix file from the output dir", async () => {
    const dir2 = outDir();
    const out = await runPdfToPdfA({ filePath: src, pdfaVersion: "2b" }, ctx, dir2);
    expect(existsSync(join(dir2, "pdfa.pdf"))).toBe(true);
    expect(existsSync(join(dir2, "pdfa-def.ps"))).toBe(false);
    expect(out).toBe(join(dir2, "pdfa.pdf"));
  }, TIMEOUT);

  it("maps a missing input file to CORRUPT_PDF", async () => {
    await expect(
      runPdfToPdfA({ filePath: join(outDir(), "nope.pdf"), pdfaVersion: "2b" }, ctx, outDir())
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CORRUPT_PDF });
  });

  it("throws CANCELLED when cancelled before doing any work", async () => {
    await expect(
      runPdfToPdfA(
        { filePath: src, pdfaVersion: "2b" },
        { ...ctx, cancelled: () => true },
        outDir()
      )
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
  });
});


