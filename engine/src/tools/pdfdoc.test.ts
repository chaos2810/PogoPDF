import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPdf, savePdf } from "./pdfdoc";
import { buildFromPages } from "./organize/organize";
import { fixtureDir, encryptedPdfBytes } from "../testing/fixtures";

// Distinct per-page widths make page order observable without text extraction.
async function makeSizedDoc(widths: number[]): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 200]);
  return doc;
}

describe("loadPdf", () => {
  let dir: string;
  beforeAll(async () => {
    dir = fixtureDir("pdfdoc");
    const ok = await PDFDocument.create();
    ok.addPage([100, 200]);
    ok.addPage([101, 200]);
    await writeFile(join(dir, "ok.pdf"), await ok.save());
    await writeFile(join(dir, "garbage.pdf"), Buffer.from("not a pdf at all"));
    await writeFile(join(dir, "encrypted.pdf"), encryptedPdfBytes());
  });

  it("loads a valid PDF", async () => {
    const doc = await loadPdf(join(dir, "ok.pdf"));
    expect(doc.getPageCount()).toBe(2);
  });

  it("throws CORRUPT_PDF for a missing file", async () => {
    await expect(loadPdf(join(dir, "missing.pdf"))).rejects.toMatchObject({
      code: -32003,
    });
  });

  it("throws CORRUPT_PDF for unreadable bytes", async () => {
    await expect(loadPdf(join(dir, "garbage.pdf"))).rejects.toMatchObject({
      code: -32003,
    });
  });

  it("throws ENCRYPTED_PDF for an encrypted file", async () => {
    await expect(loadPdf(join(dir, "encrypted.pdf"))).rejects.toMatchObject({
      code: -32002,
    });
  });
});

describe("savePdf", () => {
  it("writes outDir/output.pdf by default and returns the path", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
    const doc = await PDFDocument.create();
    doc.addPage([100, 200]);
    const out = await savePdf(doc, outDir);
    expect(out).toBe(join(outDir, "output.pdf"));
    const loaded = await PDFDocument.load(await readFile(out));
    expect(loaded.getPageCount()).toBe(1);
  });

  it("honors a custom name", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
    const doc = await PDFDocument.create();
    doc.addPage([100, 200]);
    const out = await savePdf(doc, outDir, "merged.pdf");
    expect(out).toBe(join(outDir, "merged.pdf"));
  });
});

describe("buildFromPages", () => {
  it("copies pages in the given order", async () => {
    const src = await makeSizedDoc([100, 101, 102, 103]);
    const out = await buildFromPages(src, [
      { index: 2 },
      { index: 0 },
      { index: 3 },
      { index: 1 },
    ]);
    expect(out.getPages().map((p) => p.getWidth())).toEqual([102, 100, 103, 101]);
  });

  it("applies absolute rotation via setRotation", async () => {
    const src = await makeSizedDoc([100]);
    src.getPage(0).setRotation(degrees(90));
    const out = await buildFromPages(src, [{ index: 0, rotate: 180 }]);
    expect(out.getPage(0).getRotation().angle).toBe(180);
  });

  it("applies rotation to a subset without touching others", async () => {
    const src = await makeSizedDoc([100, 101]);
    const out = await buildFromPages(src, [{ index: 0, rotate: 270 }, { index: 1 }]);
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([270, 0]);
  });

  it("allows duplicate source indices", async () => {
    const src = await makeSizedDoc([100, 101, 102]);
    const out = await buildFromPages(src, [
      { index: 1 },
      { index: 1 },
      { index: 0, rotate: 90 },
    ]);
    expect(out.getPages().map((p) => p.getWidth())).toEqual([101, 101, 100]);
    expect(out.getPage(2).getRotation().angle).toBe(90);
  });
});
