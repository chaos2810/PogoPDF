import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFStream, rgb } from "pdf-lib";
import type { ComparePdfsData } from "@pogopdf/contracts";
import { encryptedPdfBytes, fixtureDir, makePdf } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { registerTools } from "../registry";
import { runComparePdfs } from "./comparepdfs";
import { runPdfsToZip } from "./pdfstozip";
import { runRasterize } from "./rasterize";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-utility-"));
}

/** Draws a large black square over `pageIndex` of an existing PDF, in place. */
async function addBlackSquare(path: string, pageIndex: number): Promise<void> {
  const doc = await PDFDocument.load(await readFile(path));
  const page = doc.getPage(pageIndex);
  const { width, height } = page.getSize();
  page.drawRectangle({
    x: width * 0.1,
    y: height * 0.1,
    width: width * 0.8,
    height: height * 0.8,
    color: rgb(0, 0, 0),
  });
  writeFileSync(path, await doc.save());
}

/** Blank pages of the given sizes (white raster, no content stream). */
async function makeBlankPdf(
  path: string,
  sizes: Array<[number, number]>
): Promise<string> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const size of sizes) doc.addPage(size);
  writeFileSync(path, await doc.save());
  return path;
}

/** Pixel width of the first embedded image XObject on a saved PDF's page 0. */
async function embeddedImageWidth(path: string): Promise<number> {
  const doc = await PDFDocument.load(await readFile(path));
  const resources = doc.getPage(0).node.Resources();
  const xobjects = resources?.lookupMaybe(PDFName.XObject, PDFDict);
  if (!xobjects) throw new Error("page has no XObjects");
  for (const key of xobjects.keys()) {
    const stream = xobjects.lookupMaybe(key, PDFStream);
    if (!(stream instanceof PDFRawStream)) continue;
    if (stream.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    const width = stream.dict.get(PDFName.of("Width"));
    if (!(width instanceof PDFNumber)) throw new Error("image XObject has no Width");
    return width.asNumber();
  }
  throw new Error("page has no image XObject");
}

/** Total non-white-ish pixels of a page rendered at `dpi`. */
async function countInk(path: string, pageIndex: number, dpi: number): Promise<number> {
  const renderer = await getPdfRenderer(path);
  try {
    const canvas = await renderer.renderPage(pageIndex, dpi);
    const { data } = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) ink++;
    }
    return ink;
  } finally {
    await renderer.close();
  }
}

describe("runComparePdfs", () => {
  let dir: string;
  let base: string;

  beforeAll(async () => {
    dir = fixtureDir("utility");
    base = await makePdf(join(dir, "cmp-base.pdf"), 2);
  });

  it("reports identical documents as equal with no differing pages", async () => {
    const copy = join(dir, "cmp-copy.pdf");
    copyFileSync(base, copy);
    const data: ComparePdfsData = await runComparePdfs(
      { filePaths: [base, copy] },
      ctx,
      outDir()
    );

    expect(data).toEqual({
      pageCountA: 2,
      pageCountB: 2,
      samePageCounts: true,
      differingPages: [],
      pageSizeMismatchPages: [],
    });
  });

  it("flags the page carrying an added black square (1-based)", async () => {
    const modified = join(dir, "cmp-modified.pdf");
    copyFileSync(base, modified);
    await addBlackSquare(modified, 1);

    const data = await runComparePdfs(
      { filePaths: [base, modified] },
      ctx,
      outDir()
    );
    expect(data.samePageCounts).toBe(true);
    expect(data.differingPages).toEqual([2]);
    expect(data.pageSizeMismatchPages).toEqual([]);
  });

  it("reports a page-count mismatch and compares only the common pages", async () => {
    const three = await makePdf(join(dir, "cmp-three.pdf"), 3);
    const data = await runComparePdfs({ filePaths: [base, three] }, ctx, outDir());

    expect(data.pageCountA).toBe(2);
    expect(data.pageCountB).toBe(3);
    expect(data.samePageCounts).toBe(false);
    // Common pages 1-2 are identical; the extra page in B is never compared.
    expect(data.differingPages).toEqual([]);
    expect(data.pageSizeMismatchPages).toEqual([]);
  });

  it("lists size-mismatched pages separately from content differences", async () => {
    const small = await makeBlankPdf(join(dir, "cmp-blank-small.pdf"), [[200, 200]]);
    const large = await makeBlankPdf(join(dir, "cmp-blank-large.pdf"), [[400, 400]]);

    const data = await runComparePdfs({ filePaths: [small, large] }, ctx, outDir());
    expect(data.pageSizeMismatchPages).toEqual([1]);
    // Same (blank) content on both grids: a size-only difference is not a diff.
    expect(data.differingPages).toEqual([]);
  });

  it("maps an encrypted input to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "cmp-encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());

    await expect(
      runComparePdfs({ filePaths: [base, enc] }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
    await expect(
      runComparePdfs({ filePaths: [enc, base] }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
  });

  it("reports progress per common page, ending at 100", async () => {
    const events: number[] = [];
    await runComparePdfs(
      { filePaths: [base, base] },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events).toEqual([50, 100]);
  });

  it("throws CANCELLED when cancelled after the first page", async () => {
    let cancelled = false;
    await expect(
      runComparePdfs(
        { filePaths: [base, base] },
        {
          ...ctx,
          cancelled: () => cancelled,
          notifyProgress: () => {
            cancelled = true;
          },
        },
        outDir()
      )
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("runPdfsToZip", () => {
  let dir: string;
  let one: string;
  let two: string;

  beforeAll(async () => {
    dir = fixtureDir("utility");
    one = await makePdf(join(dir, "zip-one.pdf"), 1);
    two = await makePdf(join(dir, "zip-two.pdf"), 1);
  });

  it("writes archive.zip with one entry per input basename", async () => {
    const out = await runPdfsToZip({ filePaths: [one, two] }, ctx, outDir());
    expect(out.endsWith("archive.zip")).toBe(true);

    const buf = readFileSync(out);
    expect([buf[0], buf[1]]).toEqual([0x50, 0x4b]);

    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).sort()).toEqual(["zip-one.pdf", "zip-two.pdf"]);
    expect(await zip.file("zip-one.pdf")!.async("nodebuffer")).toEqual(
      readFileSync(one)
    );
  });

  it("disambiguates same-basename files from different directories", async () => {
    const sub1 = join(dir, "zip-sub1");
    const sub2 = join(dir, "zip-sub2");
    mkdirSync(sub1, { recursive: true });
    mkdirSync(sub2, { recursive: true });
    const dup1 = await makePdf(join(sub1, "dup.pdf"), 1);
    const dup2 = await makePdf(join(sub2, "dup.pdf"), 1);

    const out = await runPdfsToZip({ filePaths: [dup1, dup2] }, ctx, outDir());
    const zip = await JSZip.loadAsync(readFileSync(out));
    expect(Object.keys(zip.files).sort()).toEqual(["dup-2.pdf", "dup.pdf"]);
  });

  it("keeps a generated suffix from overwriting a real file of that name", async () => {
    const subA = join(dir, "zip-collide-a");
    const subB = join(dir, "zip-collide-b");
    const subC = join(dir, "zip-collide-c");
    for (const sub of [subA, subB, subC]) mkdirSync(sub, { recursive: true });
    // Second input is literally named "x-2.pdf"; the later "x.pdf" must not
    // reuse that name, or JSZip would replace (drop) an input silently.
    const x2 = await makePdf(join(subA, "x-2.pdf"), 1);
    const x1 = await makePdf(join(subB, "x.pdf"), 1);
    const x3 = await makePdf(join(subC, "x.pdf"), 1);

    const out = await runPdfsToZip({ filePaths: [x2, x1, x3] }, ctx, outDir());
    const zip = await JSZip.loadAsync(readFileSync(out));
    const names = Object.keys(zip.files);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(names.sort()).toEqual(["x-2.pdf", "x-3.pdf", "x.pdf"]);
    expect(await zip.file("x.pdf")!.async("nodebuffer")).toEqual(readFileSync(x1));
    expect(await zip.file("x-2.pdf")!.async("nodebuffer")).toEqual(readFileSync(x2));
  });

  it("reports progress per file, ending at 100", async () => {
    const files: string[] = [];
    for (let i = 0; i < 5; i++) {
      files.push(await makePdf(join(dir, `zip-many-${i}.pdf`), 1));
    }
    const events: number[] = [];
    await runPdfsToZip(
      { filePaths: files },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events).toEqual([20, 40, 60, 80, 100]);
  });

  it("throws CORRUPT_PDF naming a missing input", async () => {
    const missing = join(dir, "zip-missing.pdf");
    await expect(
      runPdfsToZip({ filePaths: [one, missing] }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003, message: expect.stringContaining("zip-missing.pdf") });
  });

  it("throws CANCELLED when cancelled after the first file", async () => {
    let cancelled = false;
    await expect(
      runPdfsToZip(
        { filePaths: [one, two] },
        {
          ...ctx,
          cancelled: () => cancelled,
          notifyProgress: () => {
            cancelled = true;
          },
        },
        outDir()
      )
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("runRasterize", () => {
  let dir: string;
  let two: string;

  beforeAll(async () => {
    dir = fixtureDir("utility");
    two = await makePdf(join(dir, "raster-two.pdf"), 2);
  });

  it("rebuilds each page at its displayed size with text removed", async () => {
    const out = await runRasterize({ filePath: two, dpi: 150 }, ctx, outDir());
    expect(out.endsWith("rasterized.pdf")).toBe(true);

    const doc = await PDFDocument.load(await readFile(out));
    expect(doc.getPageCount()).toBe(2);
    for (let i = 0; i < doc.getPageCount(); i++) {
      expect(doc.getPage(i).getWidth()).toBeCloseTo(595.28, 2);
      expect(doc.getPage(i).getHeight()).toBeCloseTo(841.89, 2);
    }

    const renderer = await getPdfRenderer(out);
    try {
      for (let i = 0; i < renderer.pageCount; i++) {
        expect(await extractPageText(await renderer.getPage(i))).toBe("");
      }
    } finally {
      await renderer.close();
    }
  });

  it("keeps the rendered content visible (not blank)", async () => {
    const out = await runRasterize({ filePath: two, dpi: 72 }, ctx, outDir());
    expect(await countInk(out, 0, 72)).toBeGreaterThan(0);
  });

  it("scales the embedded raster with dpi", async () => {
    const low = await runRasterize({ filePath: two, dpi: 72 }, ctx, outDir());
    const high = await runRasterize({ filePath: two, dpi: 150 }, ctx, outDir());

    const lowWidth = await embeddedImageWidth(low);
    const highWidth = await embeddedImageWidth(high);
    expect(lowWidth).toBe(595);
    expect(highWidth / lowWidth).toBeCloseTo(150 / 72, 1);
  });

  it("uses the swapped displayed dimensions for a /Rotate 90 page", async () => {
    const rotated = await makePdf(join(dir, "raster-rot.pdf"), 1, {
      sizes: [[200, 100]],
      rotations: [90],
    });
    const out = await runRasterize({ filePath: rotated, dpi: 72 }, ctx, outDir());
    const doc = await PDFDocument.load(await readFile(out));
    expect(doc.getPage(0).getWidth()).toBe(100);
    expect(doc.getPage(0).getHeight()).toBe(200);
  });

  it("maps an encrypted input to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "raster-encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runRasterize({ filePath: enc, dpi: 72 }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
  });

  it("reports progress per page, ending at 100", async () => {
    const events: number[] = [];
    await runRasterize(
      { filePath: two, dpi: 72 },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events).toEqual([50, 100]);
  });

  it("throws CANCELLED when cancelled after the first page", async () => {
    let cancelled = false;
    await expect(
      runRasterize(
        { filePath: two, dpi: 72 },
        {
          ...ctx,
          cancelled: () => cancelled,
          notifyProgress: () => {
            cancelled = true;
          },
        },
        outDir()
      )
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("utility registry", () => {
  it("registers comparePdfs, pdfsToZip, rasterize, overlay and workflow", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("comparePdfs")).toBe(true);
    expect(tools.has("pdfsToZip")).toBe(true);
    expect(tools.has("rasterize")).toBe(true);
    expect(tools.has("overlay")).toBe(true);
    expect(tools.has("workflow")).toBe(true);
  });
});
