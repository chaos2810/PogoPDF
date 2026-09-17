import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptedPdfBytes, fixtureDir, makePdf } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { registerTools } from "../registry";
import { runPageNumbers } from "./pagenumbers";
import { runHeaderFooter } from "./headerfooter";
import { parseHexColor } from "./pagedraw";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-edit-"));
}

/** Blank fixture: page text is exactly what the tool draws, no fixture noise. */
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

/**
 * pdf.js text items projected into RENDERED (viewport) space: x from the left,
 * y from the TOP, at scale 1 (1pt == 1px). Because the viewport matrix already
 * carries the page's /Rotate, a correctly placed upright string reads with
 * b ~= 0, a > 0, d < 0 and its (x, y) lands on the intended displayed corner.
 */
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

/** The single rendered item whose string matches `text`. */
function find(items: RenderedItem[], text: string): RenderedItem {
  const hit = items.find((i) => i.str.trim() === text);
  expect(hit, `no rendered text item "${text}"`).toBeDefined();
  return hit!;
}

describe("runPageNumbers", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("edit-pages");
  });

  it('renders "n" as the page number on every page', async () => {
    const src = await blankPdf(join(dir, "n.pdf"), 3);
    const out = await runPageNumbers(
      { filePath: src, position: "bottom-center", format: "n" },
      ctx,
      outDir()
    );
    expect(out.endsWith("numbered.pdf")).toBe(true);
    expect(await pageTexts(out)).toEqual(["1", "2", "3"]);
  });

  it('renders "n-of-total" with the full document count', async () => {
    const src = await blankPdf(join(dir, "n-of-total.pdf"), 3);
    const out = await runPageNumbers(
      { filePath: src, position: "bottom-center", format: "n-of-total" },
      ctx,
      outDir()
    );
    const pages = await pageTexts(out);
    expect(pages[0]).toContain("1 / 3");
    expect(pages[2]).toContain("3 / 3");
  });

  it('renders "page-n" as "Page N"', async () => {
    const src = await blankPdf(join(dir, "page-n.pdf"), 3);
    const out = await runPageNumbers(
      { filePath: src, position: "top-center", format: "page-n" },
      ctx,
      outDir()
    );
    const pages = await pageTexts(out);
    expect(pages[1]).toBe("Page 2");
  });

  it("numbers a selection by document index, not by selection order", async () => {
    const src = await blankPdf(join(dir, "selection.pdf"), 3);
    const out = await runPageNumbers(
      { filePath: src, position: "bottom-center", format: "n", pages: "2" },
      ctx,
      outDir()
    );
    expect(await pageTexts(out)).toEqual(["", "2", ""]);
  });

  it("offsets the whole run by startNumber", async () => {
    const src = await blankPdf(join(dir, "start.pdf"), 2);
    const out = await runPageNumbers(
      { filePath: src, position: "bottom-center", format: "n", startNumber: 5 },
      ctx,
      outDir()
    );
    expect(await pageTexts(out)).toEqual(["5", "6"]);
  });

  it("skipFirst leaves the document's first page unnumbered", async () => {
    const src = await blankPdf(join(dir, "skip.pdf"), 3);
    const out = await runPageNumbers(
      { filePath: src, position: "bottom-center", format: "n", skipFirst: true },
      ctx,
      outDir()
    );
    // The number still reflects the document index, so page 2 shows "2".
    expect(await pageTexts(out)).toEqual(["", "2", "3"]);
  });

  it("places bottom-right and top-left in the correct displayed quadrants", async () => {
    const src = await blankPdf(join(dir, "corners.pdf"), 1);
    const bottomRight = await runPageNumbers(
      { filePath: src, position: "bottom-right", format: "n" },
      ctx,
      outDir()
    );
    const topLeft = await runPageNumbers(
      { filePath: src, position: "top-left", format: "n" },
      ctx,
      outDir()
    );

    const [br] = await renderedItems(bottomRight, 0);
    expect(br.x).toBeGreaterThan(595.28 / 2);
    // Rendered y grows downward, so "bottom" means y > height/2.
    expect(br.y).toBeGreaterThan(841.89 / 2);
    expect(br.b).toBeCloseTo(0, 5);
    expect(br.a).toBeGreaterThan(0);
    expect(br.d).toBeLessThan(0);

    const [tl] = await renderedItems(topLeft, 0);
    expect(tl.x).toBeLessThan(595.28 / 2);
    expect(tl.y).toBeLessThan(841.89 / 2);
  });

  it("draws upright at the displayed bottom-center of a /Rotate 90 page", async () => {
    // 200x100 with /Rotate 90 displays as 100x200. Without counter-rotating
    // the text this lands sideways: the regression this test guards.
    const src = await blankPdf(join(dir, "rot90.pdf"), 1, {
      size: [200, 100],
      rotations: [90],
    });
    const out = await runPageNumbers(
      { filePath: src, position: "bottom-center", format: "n" },
      ctx,
      outDir()
    );

    const [item] = await renderedItems(out, 0);
    expect(item.str).toBe("1");
    // Upright in displayed space.
    expect(item.b).toBeCloseTo(0, 5);
    expect(item.a).toBeGreaterThan(0);
    expect(item.d).toBeLessThan(0);
    // Horizontally centered, baseline one margin (28) above the displayed bottom.
    expect(item.x + item.width / 2).toBeCloseTo(50, 1);
    expect(item.y).toBeCloseTo(200 - 28, 0);
  });

  it("draws upright at the displayed bottom-right of a /Rotate 270 page", async () => {
    const src = await blankPdf(join(dir, "rot270.pdf"), 1, {
      size: [200, 100],
      rotations: [270],
    });
    const out = await runPageNumbers(
      { filePath: src, position: "bottom-right", format: "n" },
      ctx,
      outDir()
    );
    const [item] = await renderedItems(out, 0);
    expect(item.b).toBeCloseTo(0, 5);
    expect(item.a).toBeGreaterThan(0);
    expect(item.d).toBeLessThan(0);
    // Displayed box is 100x200: right edge minus margin, baseline above bottom.
    expect(item.x + item.width).toBeCloseTo(100 - 28, 1);
    expect(item.y).toBeCloseTo(200 - 28, 0);
  });

  it("draws upright at the displayed bottom-center of a /Rotate 180 page", async () => {
    // 200x100 unrotated; /Rotate 180 keeps those dimensions but flips both
    // axes, so the bottom-center anchor must be mapped through `toUnrotated`.
    const src = await blankPdf(join(dir, "rot180.pdf"), 1, {
      size: [200, 100],
      rotations: [180],
    });
    const out = await runPageNumbers(
      { filePath: src, position: "bottom-center", format: "n" },
      ctx,
      outDir()
    );

    const [item] = await renderedItems(out, 0);
    expect(item.str).toBe("1");
    expect(item.b).toBeCloseTo(0, 5);
    expect(item.a).toBeGreaterThan(0);
    expect(item.d).toBeLessThan(0);
    expect(item.x + item.width / 2).toBeCloseTo(100, 1);
    expect(item.y).toBeCloseTo(100 - 28, 0);
  });

  it("reports progress per page, ending at 100", async () => {
    const src = await blankPdf(join(dir, "progress.pdf"), 3);
    const events: number[] = [];
    await runPageNumbers(
      { filePath: src, position: "bottom-center", format: "n" },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events).toEqual([33, 67, 100]);
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
      runPageNumbers(
        { filePath: src, position: "bottom-center", format: "n" },
        cancelCtx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runPageNumbers(
        { filePath: enc, position: "bottom-center", format: "n" },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32002 });
  });
});

describe("runHeaderFooter", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("edit-headerfooter");
  });

  it("draws header at top-center and footer at bottom-center", async () => {
    const src = await blankPdf(join(dir, "both.pdf"), 1);
    const out = await runHeaderFooter(
      { filePath: src, header: "CONFIDENTIAL", footer: "Draft" },
      ctx,
      outDir()
    );
    expect(out.endsWith("header-footer.pdf")).toBe(true);
    expect(existsSync(out)).toBe(true);

    const items = await renderedItems(out, 0);
    const header = find(items, "CONFIDENTIAL");
    const footer = find(items, "Draft");
    expect(header.x + header.width / 2).toBeCloseTo(595.28 / 2, 0);
    expect(footer.x + footer.width / 2).toBeCloseTo(595.28 / 2, 0);
    // Rendered y grows downward: header above the middle, footer below it.
    expect(header.y).toBeLessThan(841.89 / 2);
    expect(footer.y).toBeGreaterThan(841.89 / 2);
  });

  it("applies only the provided role", async () => {
    const src = await blankPdf(join(dir, "footer-only.pdf"), 1);
    const out = await runHeaderFooter(
      { filePath: src, header: "   ", footer: "Bottom" },
      ctx,
      outDir()
    );
    expect(await pageTexts(out)).toEqual(["Bottom"]);
  });

  it("stamps only the selected pages", async () => {
    const src = await blankPdf(join(dir, "selected.pdf"), 3);
    const out = await runHeaderFooter(
      { filePath: src, header: "H", footer: "F", pages: "1-2" },
      ctx,
      outDir()
    );
    expect(await pageTexts(out)).toEqual(["H F", "H F", ""]);
  });

  it("rejects non-Latin header text as INVALID_INPUT, not an internal error", async () => {
    const src = await blankPdf(join(dir, "cjk.pdf"), 1);
    await expect(
      runHeaderFooter({ filePath: src, header: "第 1 頁" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("reports progress per page, ending at 100", async () => {
    const src = await blankPdf(join(dir, "progress.pdf"), 2);
    const events: number[] = [];
    await runHeaderFooter(
      { filePath: src, header: "H" },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events).toEqual([50, 100]);
  });

  it("throws CANCELLED when cancelled between pages", async () => {
    const src = await blankPdf(join(dir, "cancel.pdf"), 2);
    let cancelled = false;
    const cancelCtx = {
      ...ctx,
      cancelled: () => cancelled,
      notifyProgress: () => {
        cancelled = true;
      },
    };
    await expect(
      runHeaderFooter({ filePath: src, footer: "F" }, cancelCtx, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("maps an encrypted PDF to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runHeaderFooter({ filePath: enc, footer: "F" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
  });
});

describe("edit registry", () => {
  it("registers pageNumbers and headerFooter", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("pageNumbers")).toBe(true);
    expect(tools.has("headerFooter")).toBe(true);
  });
});

describe("runPageNumbers preserves existing content", () => {
  it("keeps the source page text when adding a number", async () => {
    const dir = fixtureDir("edit-pages");
    const src = await makePdf(join(dir, "content.pdf"), 2);
    const out = await runPageNumbers(
      { filePath: src, position: "bottom-center", format: "n" },
      ctx,
      outDir()
    );
    const pages = await pageTexts(out);
    expect(pages[0]).toContain("Page 1");
    expect(pages[0]).toContain("1");
    expect(pages[1]).toContain("Page 2");
    expect(pages[1]).toContain("2");
  });
});

describe("parseHexColor", () => {
  it("converts #rrggbb to 0..1 rgb channels", () => {
    expect(parseHexColor("#ff8000")).toEqual({ r: 1, g: 128 / 255, b: 0 });
    expect(parseHexColor("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("rejects a malformed hex string with INVALID_INPUT", () => {
    expect(() => parseHexColor("red")).toThrowError(
      expect.objectContaining({ code: -32001 })
    );
  });
});
