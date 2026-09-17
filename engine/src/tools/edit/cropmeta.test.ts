import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument, PDFName, PDFRawStream, degrees } from "pdf-lib";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptedPdfBytes, fixtureDir, makePdf } from "../../testing/fixtures";
import { registerTools } from "../registry";
import { runCrop } from "./crop";
import { runEditMetadata } from "./editmetadata";
import { runRemoveMetadata } from "./removemetadata";
import { runViewMetadata } from "../convertout/viewmetadata";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-cropmeta-"));
}

/** Blank fixture pages at explicit sizes, with optional per-page /Rotate. */
async function blankPdf(
  path: string,
  sizes: Array<[number, number]>,
  rotations: number[] = []
): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < sizes.length; i++) {
    const page = doc.addPage(sizes[i]);
    if (rotations[i]) page.setRotation(degrees(rotations[i]));
  }
  writeFileSync(path, await doc.save());
  return path;
}

/** MediaBox rectangle read back from the produced file (unrotated user space). */
async function mediaBox(
  path: string,
  pageIndex = 0
): Promise<{ x: number; y: number; width: number; height: number }> {
  const doc = await PDFDocument.load(readFileSync(path), { updateMetadata: false });
  return doc.getPage(pageIndex).getMediaBox();
}

async function cropBox(path: string, pageIndex = 0) {
  const doc = await PDFDocument.load(readFileSync(path), { updateMetadata: false });
  return doc.getPage(pageIndex).getCropBox();
}

describe("runCrop", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("edit-crop");
  });

  it("shrinks the MediaBox from the displayed top and keeps the y origin", async () => {
    // A4 portrait. Insets in viewer space: top 10 means the box starts 10pt below
    // the displayed top edge. With no rotation, MediaBox height shrinks by 10 and
    // the lower-left y is unchanged.
    const src = await blankPdf(join(dir, "a4.pdf"), [[595.28, 841.89]]);
    const out = await runCrop({ filePath: src, top: 10 }, ctx, outDir());
    expect(out.endsWith("cropped.pdf")).toBe(true);

    const box = await mediaBox(out);
    expect(box.x).toBeCloseTo(0, 3);
    expect(box.y).toBeCloseTo(0, 3);
    expect(box.width).toBeCloseTo(595.28, 2);
    expect(box.height).toBeCloseTo(841.89 - 10, 2);
  });

  it("insets displayed left/right/bottom (no rotation)", async () => {
    const src = await blankPdf(join(dir, "edges.pdf"), [[200, 300]]);
    const out = await runCrop(
      { filePath: src, left: 20, right: 30, bottom: 40 },
      ctx,
      outDir()
    );
    const box = await mediaBox(out);
    expect(box.x).toBeCloseTo(20, 3);
    expect(box.y).toBeCloseTo(40, 3);
    expect(box.width).toBeCloseTo(200 - 20 - 30, 2);
    expect(box.height).toBeCloseTo(300 - 40, 2);
  });

  it("sets CropBox equal to the new MediaBox", async () => {
    const src = await blankPdf(join(dir, "cropbox.pdf"), [[200, 300]]);
    const out = await runCrop({ filePath: src, top: 15, left: 15 }, ctx, outDir());
    expect(await cropBox(out)).toEqual(await mediaBox(out));
  });

  it("maps viewer top to the correct MediaBox axis for /Rotate 90", async () => {
    // 200x100 with /Rotate 90 displays as 100 wide x 200 tall. Viewer "top" is a
    // DISPLAYED edge; under /Rotate 90 (clockwise) it corresponds to the MediaBox
    // LEFT edge, so width must shrink while height is unchanged.
    const src = await blankPdf(join(dir, "rot90.pdf"), [[200, 100]], [90]);
    const out = await runCrop({ filePath: src, top: 20 }, ctx, outDir());

    const box = await mediaBox(out);
    expect(box.width).toBeCloseTo(200 - 20, 2);
    expect(box.height).toBeCloseTo(100, 2);
  });

  it("maps viewer top to the correct MediaBox axis for /Rotate 270", async () => {
    // /Rotate 270 (counter-clockwise in viewer terms) makes the displayed top the
    // MediaBox RIGHT edge, so width shrinks from the right.
    const src = await blankPdf(join(dir, "rot270.pdf"), [[200, 100]], [270]);
    const out = await runCrop({ filePath: src, top: 20 }, ctx, outDir());
    const box = await mediaBox(out);
    expect(box.width).toBeCloseTo(200 - 20, 2);
    expect(box.height).toBeCloseTo(100, 2);
    // The right edge moved left: x origin unchanged.
    expect(box.x).toBeCloseTo(0, 3);
  });

  it("maps viewer top to the MediaBox bottom for /Rotate 180", async () => {
    // /Rotate 180 flips both axes: the displayed top is the MediaBox bottom, so
    // the y origin rises by the inset and height shrinks.
    const src = await blankPdf(join(dir, "rot180.pdf"), [[200, 300]], [180]);
    const out = await runCrop({ filePath: src, top: 30 }, ctx, outDir());
    const box = await mediaBox(out);
    expect(box.y).toBeCloseTo(30, 3);
    expect(box.height).toBeCloseTo(300 - 30, 2);
    expect(box.width).toBeCloseTo(200, 2);
  });

  it("applies only to the selected pages", async () => {
    const src = await blankPdf(join(dir, "selection.pdf"), [
      [200, 300],
      [200, 300],
      [200, 300],
    ]);
    const out = await runCrop({ filePath: src, top: 20, pages: "2" }, ctx, outDir());
    expect((await mediaBox(out, 0)).height).toBeCloseTo(300, 2);
    expect((await mediaBox(out, 1)).height).toBeCloseTo(280, 2);
    expect((await mediaBox(out, 2)).height).toBeCloseTo(300, 2);
  });

  it("rejects insets that would shrink an axis below 10pt", async () => {
    const src = await blankPdf(join(dir, "clamp.pdf"), [[200, 100]]);
    await expect(
      runCrop({ filePath: src, top: 95, bottom: 95 }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("accepts a 10pt result and rejects one just under it", async () => {
    // 100 tall: top 45 + bottom 45 leaves exactly 10 -> allowed; 45 + 46 -> not.
    const src = await blankPdf(join(dir, "limit.pdf"), [[200, 100]]);
    const ok = await runCrop({ filePath: src, top: 45, bottom: 45 }, ctx, outDir());
    expect((await mediaBox(ok)).height).toBeCloseTo(10, 3);

    await expect(
      runCrop({ filePath: src, top: 45, bottom: 46 }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("throws CANCELLED when cancelled between pages", async () => {
    const src = await blankPdf(join(dir, "cancel.pdf"), [
      [200, 300],
      [200, 300],
    ]);
    let cancelled = false;
    await expect(
      runCrop(
        { filePath: src, top: 20 },
        { ...ctx, cancelled: () => cancelled, notifyProgress: () => (cancelled = true) },
        outDir()
      )
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(runCrop({ filePath: enc, top: 10 }, ctx, outDir())).rejects.toMatchObject({
      code: -32002,
    });
  });
});

describe("runEditMetadata", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("edit-metadata");
  });

  /** Fixture with all six edited fields plus dates already set. */
  async function populated(path: string): Promise<string> {
    const doc = await PDFDocument.create();
    doc.addPage([200, 300]);
    doc.setTitle("Old Title");
    doc.setAuthor("Old Author");
    doc.setSubject("Old Subject");
    doc.setKeywords(["old", "keywords"]);
    doc.setCreator("Old Creator");
    doc.setProducer("Old Producer");
    doc.setCreationDate(new Date("2020-01-01T00:00:00Z"));
    doc.setModificationDate(new Date("2020-02-02T00:00:00Z"));
    writeFileSync(path, await doc.save());
    return path;
  }

  it("sets a field and leaves every other field untouched", async () => {
    const src = await populated(join(dir, "set.pdf"));
    const out = await runEditMetadata({ filePath: src, title: "New Title" }, ctx, outDir());
    expect(out.endsWith("metadata.pdf")).toBe(true);

    const data = await runViewMetadata({ filePath: out }, ctx, outDir());
    expect(data.title).toBe("New Title");
    expect(data.author).toBe("Old Author");
    expect(data.subject).toBe("Old Subject");
    expect(data.keywords).toBe("old keywords");
    expect(data.creator).toBe("Old Creator");
    expect(data.producer).toBe("Old Producer");
    // Dates are not editable in v1 and must survive untouched.
    expect(data.creationDate).toBe("2020-01-01T00:00:00.000Z");
    expect(data.modificationDate).toBe("2020-02-02T00:00:00.000Z");
  });

  it("clears a field when null is passed", async () => {
    const src = await populated(join(dir, "clear.pdf"));
    const out = await runEditMetadata({ filePath: src, subject: null }, ctx, outDir());
    const data = await runViewMetadata({ filePath: out }, ctx, outDir());
    expect(data.subject).toBeNull();
    expect(data.title).toBe("Old Title");
  });

  it("handles a mixed set/clear/keep input in one run", async () => {
    const src = await populated(join(dir, "mixed.pdf"));
    const out = await runEditMetadata(
      { filePath: src, title: "Fresh", author: null, producer: "New Producer" },
      ctx,
      outDir()
    );
    const data = await runViewMetadata({ filePath: out }, ctx, outDir());
    expect(data.title).toBe("Fresh");
    expect(data.author).toBeNull();
    expect(data.producer).toBe("New Producer");
    expect(data.creator).toBe("Old Creator");
  });

  it("writes a non-ASCII value round-trippably", async () => {
    const src = await populated(join(dir, "unicode.pdf"));
    const out = await runEditMetadata({ filePath: src, title: "第 1 季" }, ctx, outDir());
    const data = await runViewMetadata({ filePath: out }, ctx, outDir());
    expect(data.title).toBe("第 1 季");
  });

  it("throws CANCELLED when cancelled before doing any work", async () => {
    const src = await populated(join(dir, "cancel.pdf"));
    await expect(
      runEditMetadata({ filePath: src, title: "x" }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runEditMetadata({ filePath: enc, title: "x" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
  });
});

describe("runRemoveMetadata", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("edit-remove-metadata");
  });

  it("clears every info field so the viewMetadata read path reports nulls", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 300]);
    doc.setTitle("T");
    doc.setAuthor("A");
    doc.setSubject("S");
    doc.setKeywords(["k"]);
    doc.setCreator("C");
    doc.setProducer("P");
    doc.setCreationDate(new Date("2020-01-01T00:00:00Z"));
    doc.setModificationDate(new Date("2020-02-02T00:00:00Z"));
    const src = join(dir, "all.pdf");
    writeFileSync(src, await doc.save());

    const out = await runRemoveMetadata({ filePath: src }, ctx, outDir());
    expect(out.endsWith("no-metadata.pdf")).toBe(true);

    const data = await runViewMetadata({ filePath: out }, ctx, outDir());
    expect(data.title).toBeNull();
    expect(data.author).toBeNull();
    expect(data.subject).toBeNull();
    expect(data.keywords).toBeNull();
    expect(data.creator).toBeNull();
    expect(data.producer).toBeNull();
    expect(data.creationDate).toBeNull();
    expect(data.modificationDate).toBeNull();
  });

  it("removes the catalog /Metadata (XMP) stream when present", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 300]);
    // pdf-lib does not author XMP, so craft the raw stream the way an external
    // producer would and register it on the catalog.
    const xmp = PDFRawStream.of(
      doc.context.obj({ Type: "Metadata", Subtype: "XML" }),
      new TextEncoder().encode("<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"/>")
    );
    doc.catalog.set(PDFName.of("Metadata"), doc.context.register(xmp));
    const src = join(dir, "xmp.pdf");
    writeFileSync(src, await doc.save());

    const before = await PDFDocument.load(readFileSync(src), { updateMetadata: false });
    expect(before.catalog.get(PDFName.of("Metadata"))).toBeDefined();

    const out = await runRemoveMetadata({ filePath: src }, ctx, outDir());
    const after = await PDFDocument.load(readFileSync(out), { updateMetadata: false });
    expect(after.catalog.get(PDFName.of("Metadata"))).toBeUndefined();
  });

  it("leaves no Metadata key on a document that had none", async () => {
    const src = await makePdf(join(dir, "plain.pdf"), 1);
    const out = await runRemoveMetadata({ filePath: src }, ctx, outDir());
    const after = await PDFDocument.load(readFileSync(out), { updateMetadata: false });
    expect(after.catalog.get(PDFName.of("Metadata"))).toBeUndefined();
  });

  it("throws CANCELLED when cancelled before doing any work", async () => {
    const src = await makePdf(join(dir, "cancel.pdf"), 1);
    await expect(
      runRemoveMetadata({ filePath: src }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(runRemoveMetadata({ filePath: enc }, ctx, outDir())).rejects.toMatchObject({
      code: -32002,
    });
  });
});

describe("edit registry", () => {
  it("registers crop, editMetadata and removeMetadata", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("crop")).toBe(true);
    expect(tools.has("editMetadata")).toBe(true);
    expect(tools.has("removeMetadata")).toBe(true);
  });
});
