import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { encryptedPdfBytes } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { registerTools } from "../registry";
import { findGswin } from "./gsbin";
import { buildFontOutlineArgs, runFontOutline } from "./fontoutline";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

/** One text page built with pdf-lib (a real embedded Helvetica font). */
async function makeTextPdf(path: string): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont("Helvetica");
  const page = doc.addPage([595.28, 841.89]);
  page.drawText("Hello Outline", { x: 50, y: 750, size: 24, font });
  writeFileSync(path, await doc.save());
  return path;
}

const scratch: string[] = [];

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pogopdf-fontoutline-"));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const gsBin = findGswin();
if (!gsBin) {
  console.warn(
    "[fontoutline.test] gswin64c.exe not found - skipping Ghostscript-backed tests. " +
      "Run engine/scripts/fetch-ghostscript.ps1 to enable them."
  );
}

const TIMEOUT = 120_000;

describe("buildFontOutlineArgs", () => {
  it("carries the pdfwrite device, -dNoOutputFonts and the output/input pair", () => {
    const args = buildFontOutlineArgs("in.pdf", "out.pdf");
    expect(args).toContain("-sDEVICE=pdfwrite");
    expect(args).toContain("-dNoOutputFonts");
    expect(args).toContain("-dNOPAUSE");
    expect(args).toContain("-dBATCH");
    expect(args).toContain("-sOutputFile=out.pdf");
    expect(args.at(-1)).toBe("in.pdf");
  });

  it("does not force a PDF/A part or colour strategy", () => {
    const args = buildFontOutlineArgs("in.pdf", "out.pdf");
    expect(args.some((a) => a.startsWith("-dPDFA"))).toBe(false);
  });
});

describe.skipIf(!gsBin)("runFontOutline", () => {
  let dir: string;
  let src: string;

  beforeAll(async () => {
    dir = outDir();
    src = await makeTextPdf(join(dir, "src.pdf"));
  });

  it("writes outlined.pdf with every page /Font resource gone", async () => {
    const out = await runFontOutline({ filePath: src }, ctx, outDir());
    expect(out.endsWith("outlined.pdf")).toBe(true);
    expect(existsSync(out)).toBe(true);

    const doc = await PDFDocument.load(readFileSync(out), { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
    for (let i = 0; i < doc.getPageCount(); i++) {
      const resources = doc.getPage(i).node.Resources();
      const fonts = resources?.get(PDFName.of("Font"));
      expect(fonts, `page ${i}`).toBeUndefined();
    }
  }, TIMEOUT);

  it("keeps the visual ink (the page still renders non-blank)", async () => {
    const out = await runFontOutline({ filePath: src }, ctx, outDir());
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

  it("maps an encrypted input to ENCRYPTED_PDF", async () => {
    const enc = join(outDir(), "enc.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runFontOutline({ filePath: enc }, ctx, outDir())
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.ENCRYPTED_PDF });
  }, TIMEOUT);

  it("maps a missing input file to CORRUPT_PDF", async () => {
    await expect(
      runFontOutline({ filePath: join(outDir(), "nope.pdf") }, ctx, outDir())
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CORRUPT_PDF });
  });

  it("throws CANCELLED when cancelled before doing any work", async () => {
    await expect(
      runFontOutline({ filePath: src }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
  });
});

describe("ghostscript registry", () => {
  it("registers pdfToPdfA and fontOutline", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("pdfToPdfA")).toBe(true);
    expect(tools.has("fontOutline")).toBe(true);
  });
});
