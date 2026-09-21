import { describe, it, expect, beforeAll } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, degrees } from "pdf-lib";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureDir } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { registerTools } from "../registry";
import { runPageLabels } from "./pagelabels";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-pagelabels-"));
}

async function labels(path: string): Promise<string[] | null> {
  const renderer = await getPdfRenderer(path);
  try {
    return await renderer.getPageLabels();
  } finally {
    await renderer.close();
  }
}

/** The single /PageLabels number-tree node, read low-level. */
async function firstNode(path: string): Promise<PDFDict | undefined> {
  const doc = await PDFDocument.load(readFileSync(path));
  const tree = doc.catalog.lookupMaybe(PDFName.of("PageLabels"), PDFDict);
  const nums = tree?.lookupMaybe(PDFName.of("Nums"), PDFArray);
  if (!nums || nums.size() < 2) return undefined;
  return doc.context.lookup(nums.get(1)) as PDFDict | undefined;
}

describe("runPageLabels", () => {
  let dir: string;

  beforeAll(() => {
    dir = fixtureDir("editor-pagelabels");
  });

  it("writes a decimal label tree that pdf.js reads back", async () => {
    const src = join(dir, "decimal.pdf");
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.addPage([200, 200]);
    writeFileSync(src, await doc.save());

    const out = await runPageLabels(
      { filePath: src, style: "decimal", start: 1 },
      ctx,
      outDir()
    );
    expect(out.endsWith("labeled.pdf")).toBe(true);
    expect(await labels(out)).toEqual(["1", "2"]);
  });

  it("applies the start offset and roman-upper style", async () => {
    const src = join(dir, "roman.pdf");
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    writeFileSync(src, await doc.save());

    const out = await runPageLabels(
      { filePath: src, style: "roman-upper", start: 3 },
      ctx,
      outDir()
    );
    expect(await labels(out)).toEqual(["III"]);
  });

  it("prefixes the label string", async () => {
    const src = join(dir, "prefix.pdf");
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    writeFileSync(src, await doc.save());

    const out = await runPageLabels(
      { filePath: src, style: "decimal", start: 1, prefix: "A-" },
      ctx,
      outDir()
    );
    expect(await labels(out)).toEqual(["A-1"]);
  });

  it("styles letters-lower as repeating letters", async () => {
    const src = join(dir, "letters.pdf");
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.addPage([200, 200]);
    writeFileSync(src, await doc.save());

    const out = await runPageLabels(
      { filePath: src, style: "letters-lower", start: 1 },
      ctx,
      outDir()
    );
    expect(await labels(out)).toEqual(["a", "b"]);
  });

  it("writes no /S for the none style while keeping the prefix", async () => {
    const src = join(dir, "none.pdf");
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    writeFileSync(src, await doc.save());

    const out = await runPageLabels(
      { filePath: src, style: "none", prefix: "Cover" },
      ctx,
      outDir()
    );
    const node = await firstNode(out);
    expect(node?.has(PDFName.of("S"))).toBe(false);
    expect(await labels(out)).toEqual(["Cover"]);
  });

  it("uses /St only as an integer start", async () => {
    const src = join(dir, "st.pdf");
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    writeFileSync(src, await doc.save());

    const out = await runPageLabels(
      { filePath: src, style: "decimal", start: 12 },
      ctx,
      outDir()
    );
    const node = await firstNode(out);
    expect(node?.lookupMaybe(PDFName.of("St"), PDFNumber)?.asNumber()).toBe(12);
  });

  it("leaves rotated pages unaffected", async () => {
    const src = join(dir, "rotated.pdf");
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 100]);
    page.setRotation(degrees(90));
    writeFileSync(src, await doc.save());

    const out = await runPageLabels(
      { filePath: src, style: "decimal", start: 1 },
      ctx,
      outDir()
    );
    expect(await labels(out)).toEqual(["1"]);
  });

  it("maps a missing file to CORRUPT_PDF", async () => {
    await expect(
      runPageLabels({ filePath: join(dir, "nope.pdf"), style: "decimal" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("throws CANCELLED when cancelled before doing any work", async () => {
    const src = join(dir, "cancel.pdf");
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    writeFileSync(src, await doc.save());
    await expect(
      runPageLabels(
        { filePath: src, style: "decimal" },
        { ...ctx, cancelled: () => true },
        outDir()
      )
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("editor pageLabels registry", () => {
  it("registers pageLabels", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("pageLabels")).toBe(true);
  });
});
