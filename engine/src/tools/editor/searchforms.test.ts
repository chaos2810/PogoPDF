import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument, PDFName, StandardFonts, degrees } from "pdf-lib";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProgressParams } from "@pogopdf/contracts";
import { encryptedPdfBytes, fixtureDir } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { registerTools } from "../registry";
import { runSearch } from "./search";
import { runFormFields } from "./formfields";
import { runFormFill } from "./formfill";
import { runFormCreate } from "./formcreate";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-searchforms-"));
}

/** A blank A4 (or custom) page fixture with optional /Rotate. */
async function blankPdf(
  path: string,
  pages = 1,
  opts: { size?: [number, number]; rotation?: number } = {}
): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(opts.size ?? [595.28, 841.89]);
    if (opts.rotation) page.setRotation(degrees(opts.rotation));
  }
  writeFileSync(path, await doc.save());
  return path;
}

/** One Helvetica 24pt text line per page entry (null leaves the page blank). */
async function textPdf(path: string, pages: Array<string | null>): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([595.28, 841.89]);
    if (text) page.drawText(text, { x: 50, y: 750, size: 24, font });
  }
  writeFileSync(path, await doc.save());
  return path;
}

async function pageText(path: string, index: number): Promise<string> {
  const renderer = await getPdfRenderer(path);
  try {
    return await extractPageText(await renderer.getPage(index));
  } finally {
    await renderer.close();
  }
}

/** The first widget rect of a named field in a saved output (user space). */
async function widgetRect(path: string, fieldName: string) {
  const doc = await PDFDocument.load(readFileSync(path));
  const field = doc.getForm().getField(fieldName);
  return field.acroField.getWidgets()[0].getRectangle();
}

const A4_H = 841.89;

describe("runSearch", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("searchforms-search");
  });

  it("finds a case-insensitive match on every page it appears, with snippets", async () => {
    const src = await textPdf(join(dir, "multi.pdf"), [
      "Hello Search World",
      null,
      "Second Hello Search World",
    ]);
    const out = await runSearch({ filePath: src, query: "search" }, ctx, outDir());
    expect(out.matches).toHaveLength(2);
    expect(out.matches.map((m) => m.page)).toEqual([1, 3]);
    expect(out.matches[0].snippet).toBe("Hello Search World");
    expect(out.matches[1].snippet).toBe("Second Hello Search World");
    // Displayed frame: x=50, y from the top = 841.89 - 750.
    expect(out.matches[0].x).toBeCloseTo(50, 1);
    expect(out.matches[0].y).toBeCloseTo(A4_H - 750, 1);
  });

  it("is case-insensitive in the query", async () => {
    const src = await textPdf(join(dir, "case.pdf"), ["Hello Search World"]);
    const out = await runSearch({ filePath: src, query: "HELLO" }, ctx, outDir());
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].snippet).toContain("Hello Search World");
  });

  it("returns an empty list (not an error) when nothing matches", async () => {
    const src = await textPdf(join(dir, "none.pdf"), ["Hello Search World"]);
    const out = await runSearch({ filePath: src, query: "absent" }, ctx, outDir());
    expect(out).toEqual({ matches: [] });
  });

  it("maps a /Rotate 90 match into the displayed frame", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 200]);
    page.setRotation(degrees(90));
    // User space (50, 150) displays at (150, 50) under /Rotate 90.
    page.drawText("Hello Search World", { x: 50, y: 150, size: 24, font });
    const src = join(dir, "rot90.pdf");
    writeFileSync(src, await doc.save());

    const out = await runSearch({ filePath: src, query: "search" }, ctx, outDir());
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].x).toBeCloseTo(150, 1);
    expect(out.matches[0].y).toBeCloseTo(50, 1);
  });

  it("reports progress to 100 across a multi-page search", async () => {
    const src = await textPdf(join(dir, "progress.pdf"), [
      "Hello Search World",
      null,
      "Hello Search World",
    ]);
    const seen: ProgressParams[] = [];
    await runSearch(
      { filePath: src, query: "hello" },
      { cancelled: () => false, notifyProgress: (p) => seen.push(p) },
      outDir()
    );
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.at(-1)!.percent).toBe(100);
    expect(seen.at(-1)!.pagesDone).toBe(3);
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(runSearch({ filePath: enc, query: "x" }, ctx, outDir())).rejects.toMatchObject({
      code: -32002,
    });
  });

  it("throws CANCELLED when the job is already cancelled", async () => {
    const src = await textPdf(join(dir, "cancel.pdf"), ["Hello Search World"]);
    await expect(
      runSearch(
        { filePath: src, query: "hello" },
        { ...ctx, cancelled: () => true },
        outDir()
      )
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("caps matches at 500 without an error, stopping progress at the cap", async () => {
    // 620 repetitions of "token" on one page, each its own text line.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595.28, 841.89]);
    for (let i = 0; i < 620; i++) {
      page.drawText("token", { x: 50, y: 800 - i * 1.2, size: 1, font });
    }
    const src = join(dir, "cap.pdf");
    writeFileSync(src, await doc.save());

    const seen: ProgressParams[] = [];
    const out = await runSearch(
      { filePath: src, query: "token" },
      { cancelled: () => false, notifyProgress: (p) => seen.push(p) },
      outDir()
    );
    expect(out.matches).toHaveLength(500);
    // The cap ends the search without error; the page that hit it still
    // reports its progress tick, so a single-page run reaches 100.
    expect(seen.at(-1)!.percent).toBe(100);
    expect(seen.at(-1)!.pagesDone).toBe(1);
  });
});

describe("runFormFields", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("searchforms-fields");
  });

  it("returns an empty list (not an error) for a PDF with no form", async () => {
    const src = await blankPdf(join(dir, "formless.pdf"));
    const out = await runFormFields({ filePath: src }, ctx, outDir());
    expect(out).toEqual({ fields: [] });
  });

  it("reads back name, type, options, and flags from a created form", async () => {
    const src = await blankPdf(join(dir, "created-source.pdf"));
    const form = await runFormCreate(
      {
        filePath: src,
        page: 1,
        fields: [
          { name: "fullName", label: "Full name", type: "text", x: 40, y: 40, w: 200, h: 24 },
          { name: "agree", label: "Agree", type: "checkbox", x: 40, y: 90, w: 24, h: 24 },
          {
            name: "color",
            label: "Color",
            type: "dropdown",
            x: 40,
            y: 140,
            w: 200,
            h: 24,
            options: ["red", "green"],
          },
        ],
      },
      ctx,
      outDir()
    );

    const out = await runFormFields({ filePath: form }, ctx, outDir());
    expect(out.fields).toHaveLength(3);
    const byName = new Map(out.fields.map((f) => [f.name, f]));
    expect(byName.get("fullName")).toMatchObject({
      type: "text",
      readOnly: false,
      required: false,
    });
    expect(byName.get("agree")).toMatchObject({ type: "checkbox" });
    expect(byName.get("color")).toMatchObject({ type: "dropdown", options: ["red", "green"] });
  });

  it("enumerates radio groups with their options", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const form = doc.getForm();
    const radio = form.createRadioGroup("pet");
    radio.addOptionToPage("cat", page, { x: 20, y: 20, width: 24, height: 24 });
    radio.addOptionToPage("dog", page, { x: 20, y: 60, width: 24, height: 24 });
    const src = join(dir, "radio.pdf");
    writeFileSync(src, await doc.save());

    const out = await runFormFields({ filePath: src }, ctx, outDir());
    expect(out.fields).toHaveLength(1);
    expect(out.fields[0]).toMatchObject({ name: "pet", type: "radio", options: ["cat", "dog"] });
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(runFormFields({ filePath: enc }, ctx, outDir())).rejects.toMatchObject({
      code: -32002,
    });
  });
});

describe("runFormFill", () => {
  let dir: string;
  let source: string;

  beforeAll(async () => {
    dir = fixtureDir("searchforms-fill");
    const blank = await blankPdf(join(dir, "blank.pdf"));
    source = await runFormCreate(
      {
        filePath: blank,
        page: 1,
        fields: [
          { name: "fullName", label: "Full name", type: "text", x: 40, y: 40, w: 200, h: 24 },
          { name: "agree", label: "Agree", type: "checkbox", x: 40, y: 90, w: 24, h: 24 },
          {
            name: "color",
            label: "Color",
            type: "dropdown",
            x: 40,
            y: 140,
            w: 200,
            h: 24,
            options: ["red", "green"],
          },
        ],
      },
      ctx,
      outDir()
    );
  });

  it("fills text, checks a checkbox, and selects a dropdown, readable after reload", async () => {
    const filled = await runFormFill(
      {
        filePath: source,
        values: [
          { name: "fullName", value: "Ada Lovelace" },
          { name: "agree", value: "true" },
          { name: "color", value: "green" },
        ],
      },
      ctx,
      outDir()
    );
    expect(filled.endsWith("filled.pdf")).toBe(true);

    const out = await runFormFields({ filePath: filled }, ctx, outDir());
    const byName = new Map(out.fields.map((f) => [f.name, f]));
    expect(byName.get("fullName")!.value).toBe("Ada Lovelace");
    expect(byName.get("agree")!.value).toBe("true");
    expect(byName.get("color")!.value).toBe("green");
  });

  it("unchecks a checkbox when the value is false", async () => {
    const checked = await runFormFill(
      { filePath: source, values: [{ name: "agree", value: "true" }] },
      ctx,
      outDir()
    );
    const unchecked = await runFormFill(
      { filePath: checked, values: [{ name: "agree", value: "false" }] },
      ctx,
      outDir()
    );
    const out = await runFormFields({ filePath: unchecked }, ctx, outDir());
    const agree = out.fields.find((f) => f.name === "agree");
    expect(agree!.value).toBe("false");
  });

  it("leaves an omitted choice field unset instead of clearing it", async () => {
    // Only the text field is supplied; the dropdown is omitted (the UI's
    // unselected-choice contract) and must keep whatever it held.
    const seeded = await runFormFill(
      { filePath: source, values: [{ name: "color", value: "red" }] },
      ctx,
      outDir()
    );
    const filled = await runFormFill(
      { filePath: seeded, values: [{ name: "fullName", value: "Ada" }] },
      ctx,
      outDir()
    );
    const out = await runFormFields({ filePath: filled }, ctx, outDir());
    const byName = new Map(out.fields.map((f) => [f.name, f]));
    expect(byName.get("color")!.value).toBe("red");
  });

  it("rejects an unknown field name with INVALID_INPUT naming it", async () => {
    await expect(
      runFormFill({ filePath: source, values: [{ name: "nope", value: "x" }] }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32001, message: expect.stringContaining("nope") });
  });

  it("rejects a dropdown value that is not an option", async () => {
    await expect(
      runFormFill(
        { filePath: source, values: [{ name: "color", value: "blue" }] },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32001, message: expect.stringContaining("blue") });
  });

  it("rejects a radio value that is not an option", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const form = doc.getForm();
    const radio = form.createRadioGroup("pet");
    radio.addOptionToPage("cat", page, { x: 20, y: 20, width: 24, height: 24 });
    radio.addOptionToPage("dog", page, { x: 20, y: 60, width: 24, height: 24 });
    const radioSrc = join(dir, "radio-src.pdf");
    writeFileSync(radioSrc, await doc.save());

    await expect(
      runFormFill({ filePath: radioSrc, values: [{ name: "pet", value: "bird" }] }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32001, message: expect.stringContaining("bird") });

    const ok = await runFormFill(
      { filePath: radioSrc, values: [{ name: "pet", value: "dog" }] },
      ctx,
      outDir()
    );
    const out = await runFormFields({ filePath: ok }, ctx, outDir());
    expect(out.fields.find((f) => f.name === "pet")!.value).toBe("dog");
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runFormFill({ filePath: enc, values: [{ name: "a", value: "b" }] }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
  });

  it("throws CANCELLED when the job is already cancelled", async () => {
    await expect(
      runFormFill(
        { filePath: source, values: [{ name: "fullName", value: "Ada" }] },
        { ...ctx, cancelled: () => true },
        outDir()
      )
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("saves NeedAppearances true so viewers regenerate appearances", async () => {
    const filled = await runFormFill(
      { filePath: source, values: [{ name: "fullName", value: "Ada" }] },
      ctx,
      outDir()
    );
    const saved = await PDFDocument.load(readFileSync(filled));
    const flag = saved.getForm().acroForm.dict.get(PDFName.of("NeedAppearances"));
    expect(String(flag)).toBe("true");
  });
});

describe("runFormCreate", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("searchforms-create");
  });

  it("creates fields on page 2 and draws the label text there", async () => {
    const src = await blankPdf(join(dir, "two-pages.pdf"), 2);
    const out = await runFormCreate(
      {
        filePath: src,
        page: 2,
        fields: [
          { name: "a", label: "Label A", type: "text", x: 40, y: 40, w: 200, h: 24 },
          { name: "b", label: "Label B", type: "checkbox", x: 40, y: 90, w: 24, h: 24 },
          {
            name: "c",
            label: "Label C",
            type: "dropdown",
            x: 40,
            y: 140,
            w: 200,
            h: 24,
            options: ["one", "two"],
          },
        ],
      },
      ctx,
      outDir()
    );
    expect(out.endsWith("form.pdf")).toBe(true);

    const fields = await runFormFields({ filePath: out }, ctx, outDir());
    expect(fields.fields.map((f) => f.name).sort()).toEqual(["a", "b", "c"]);

    const text = await pageText(out, 1);
    expect(text).toContain("Label A");
    expect(text).toContain("Label B");
    expect(text).toContain("Label C");
    // Page 1 keeps no labels.
    expect(await pageText(out, 0)).not.toContain("Label A");
  });

  it("places a widget at displayed coordinates on a /Rotate 90 page", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 100]);
    page.setRotation(degrees(90));
    const src = join(dir, "rot90.pdf");
    writeFileSync(src, await doc.save());

    const out = await runFormCreate(
      {
        filePath: src,
        page: 1,
        fields: [{ name: "rot", label: "Rotated", type: "text", x: 10, y: 20, w: 60, h: 24 }],
      },
      ctx,
      outDir()
    );

    // Displayed (10,20,60,24) on a 100x200 page maps to the user-space box
    // (20,10)-(44,70): toUnrotated(90) swaps the axes.
    const rect = await widgetRect(out, "rot");
    expect(rect.x).toBeCloseTo(20, 1);
    expect(rect.y).toBeCloseTo(10, 1);
    expect(rect.width).toBeCloseTo(24, 1);
    expect(rect.height).toBeCloseTo(60, 1);
  });

  it("rejects a page number beyond the document", async () => {
    const src = await blankPdf(join(dir, "one-page.pdf"), 1);
    await expect(
      runFormCreate(
        {
          filePath: src,
          page: 5,
          fields: [{ name: "a", label: "A", type: "text", x: 10, y: 10, w: 100, h: 20 }],
        },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runFormCreate(
        {
          filePath: enc,
          page: 1,
          fields: [{ name: "a", label: "A", type: "text", x: 10, y: 10, w: 100, h: 20 }],
        },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32002 });
  });

  it("rejects a non-Latin-1 label with INVALID_INPUT", async () => {
    const src = await blankPdf(join(dir, "cjk-label.pdf"));
    await expect(
      runFormCreate(
        {
          filePath: src,
          page: 1,
          fields: [{ name: "first", label: "第一頁", type: "text", x: 10, y: 10, w: 100, h: 20 }],
        },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32001 });
  });
});

describe("search and forms registry", () => {
  it("registers search, formFields, formFill, and formCreate", () => {
    const tools = new Map();
    registerTools(tools);
    for (const id of ["search", "formFields", "formFill", "formCreate"]) {
      expect(tools.has(id), id).toBe(true);
    }
  });
});
