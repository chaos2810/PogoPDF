import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureDir, makePdf } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { registerTools } from "../registry";
import { runBates, formatBates } from "./bates";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-bates-"));
}

async function blankPdf(
  path: string,
  pages: number,
  opts: { size?: [number, number]; rotations?: number[] } = {}
): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(opts.size ?? [595.28, 841.89]);
    if (opts.rotations?.[i]) page.setRotation(degrees(opts.rotations[i]));
  }
  writeFileSync(path, await doc.save());
  return path;
}

type RenderedItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  a: number;
  b: number;
  d: number;
};

async function renderedItems(path: string, pageIndex: number): Promise<RenderedItem[]> {
  const renderer = await getPdfRenderer(path);
  try {
    const page = await renderer.getPage(pageIndex);
    const viewport = page.getViewport({ scale: 1 });
    const [va, vb, vc, vd, ve, vf] = viewport.transform;
    const { items } = await page.getTextContent();
    const out: RenderedItem[] = [];
    for (const item of items) {
      if (!("str" in item) || typeof item.str !== "string" || !item.str.trim()) continue;
      const t = item.transform;
      out.push({
        str: item.str,
        x: va * t[4] + vc * t[5] + ve,
        y: vb * t[4] + vd * t[5] + vf,
        width: item.width,
        a: va * t[0] + vc * t[1],
        b: vb * t[0] + vd * t[1],
        d: vb * t[2] + vd * t[3],
      });
    }
    return out;
  } finally {
    await renderer.close();
  }
}

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

describe("formatBates", () => {
  it("formats n, prefix-n and n-of-total", () => {
    expect(formatBates("n", "", 7, 30)).toBe("7");
    expect(formatBates("prefix-n", "CASE", 7, 30)).toBe("CASE-7");
    expect(formatBates("n-of-total", "", 7, 30)).toBe("7 / 30");
  });

  it("uses the prefix even for prefix-n with no configured prefix", () => {
    expect(formatBates("prefix-n", "", 3, 3)).toBe("-3");
  });
});

describe("runBates", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("editor-bates");
  });

  it("numbers its own per-file sequence, not the document index", async () => {
    const src = await blankPdf(join(dir, "sequence.pdf"), 3);
    const out = await runBates(
      { filePath: src, position: "bottom-center", format: "n", startNumber: 7 },
      ctx,
      outDir()
    );
    expect(out.endsWith("bates.pdf")).toBe(true);
    // The first selected page shows the start number, unlike pageNumbers.
    expect(await pageTexts(out)).toEqual(["7", "8", "9"]);
  });

  it("joins a prefix and sequence with a hyphen for prefix-n", async () => {
    const src = await blankPdf(join(dir, "prefix.pdf"), 2);
    const out = await runBates(
      { filePath: src, position: "bottom-center", format: "prefix-n", prefix: "CASE", startNumber: 7 },
      ctx,
      outDir()
    );
    const pages = await pageTexts(out);
    expect(pages[0]).toBe("CASE-7");
    expect(pages[1]).toBe("CASE-8");
  });

  it("uses the selection count for n-of-total", async () => {
    const src = await blankPdf(join(dir, "total.pdf"), 5);
    const out = await runBates(
      { filePath: src, position: "bottom-center", format: "n-of-total", startNumber: 1, pages: "1-3" },
      ctx,
      outDir()
    );
    const pages = await pageTexts(out);
    expect(pages[0]).toBe("1 / 3");
    expect(pages[2]).toBe("3 / 3");
    expect(pages[3]).toBe("");
  });

  it("applies the prefix to n-of-total as well", async () => {
    const src = await blankPdf(join(dir, "total-prefix.pdf"), 2);
    const out = await runBates(
      { filePath: src, position: "bottom-center", format: "n-of-total", prefix: "EX", startNumber: 4 },
      ctx,
      outDir()
    );
    expect(await pageTexts(out)).toEqual(["EX4 / 2", "EX5 / 2"]);
  });

  it("draws upright at the displayed bottom-right of a rotated page", async () => {
    const src = await blankPdf(join(dir, "rot90.pdf"), 1, { size: [200, 100], rotations: [90] });
    const out = await runBates(
      { filePath: src, position: "bottom-right", format: "n", startNumber: 3 },
      ctx,
      outDir()
    );
    const [item] = await renderedItems(out, 0);
    expect(item.str).toBe("3");
    expect(item.b).toBeCloseTo(0, 5);
    expect(item.a).toBeGreaterThan(0);
    expect(item.d).toBeLessThan(0);
    expect(item.x + item.width).toBeCloseTo(100 - 28, 1);
    expect(item.y).toBeCloseTo(200 - 28, 0);
  });

  it("rejects a CJK prefix as INVALID_INPUT", async () => {
    const src = await blankPdf(join(dir, "cjk.pdf"), 1);
    await expect(
      runBates(
        { filePath: src, position: "bottom-center", format: "prefix-n", prefix: "第一" },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("preserves existing content", async () => {
    const src = await makePdf(join(dir, "content.pdf"), 2);
    const out = await runBates(
      { filePath: src, position: "bottom-center", format: "n", startNumber: 1 },
      ctx,
      outDir()
    );
    const pages = await pageTexts(out);
    expect(pages[0]).toContain("Page 1");
    expect(pages[0]).toContain("1");
  });

  it("throws CANCELLED when cancelled between pages", async () => {
    const src = await blankPdf(join(dir, "cancel.pdf"), 3);
    let cancelled = false;
    const cancelCtx = {
      ...ctx,
      cancelled: () => cancelled,
      notifyProgress: () => {
        cancelled = true;
      },
    };
    await expect(
      runBates({ filePath: src, position: "bottom-center", format: "n" }, cancelCtx, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("editor bates registry", () => {
  it("registers bates", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("bates")).toBe(true);
  });
});
