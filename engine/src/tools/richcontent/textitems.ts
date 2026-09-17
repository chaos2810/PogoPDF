import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

/** A positioned, non-empty text run from pdf.js page extraction. */
export type TextItem = {
  str: string;
  /** Left edge in unrotated page points. */
  x: number;
  /** Baseline y in unrotated page points (grows upward). */
  y: number;
  width: number;
  height: number;
  fontName: string;
};

/** Read visible text runs (whitespace-only spacer items are discarded). */
export async function readPageItems(page: PDFPageProxy): Promise<TextItem[]> {
  const { items } = await page.getTextContent();
  const out: TextItem[] = [];
  for (const item of items) {
    if (!("str" in item) || typeof item.str !== "string") continue;
    if (!item.str.trim()) continue;
    const t = item.transform;
    out.push({
      str: item.str,
      x: t[4],
      y: t[5],
      width: item.width,
      height: item.height > 0 ? item.height : Math.abs(t[3]),
      fontName: item.fontName,
    });
  }
  return out;
}

/**
 * Cluster items into lines by baseline y proximity. The tolerance is half the
 * median glyph height, so rows spaced at least half a line apart stay distinct
 * while items sharing a baseline group together. Baseline order is preserved
 * (top of the page first); items within a line are sorted left to right.
 */
export function clusterLines(items: TextItem[]): TextItem[][] {
  if (items.length === 0) return [];
  const heights = items
    .map((i) => i.height)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const median = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 12;
  const tol = Math.max(2, median * 0.5);

  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  let refY = sorted[0].y;
  for (const item of sorted) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(item.y - refY) <= tol) {
      current.push(item);
      refY = (refY * (current.length - 1) + item.y) / current.length;
    } else {
      lines.push([item]);
      refY = item.y;
    }
  }
  return lines.map((line) => line.sort((a, b) => a.x - b.x));
}

/**
 * Real font name for a pdf.js item (`g_d0_f1` -> "Helvetica-Bold"). Fonts are
 * resolved on the page's common object store by the operator-list pass, so the
 * caller must await `page.getOperatorList()` before asking. Missing or
 * unresolvable fonts return undefined rather than throwing.
 */
export function resolveFontName(page: PDFPageProxy, fontName: string): string | undefined {
  try {
    const font = page.commonObjs.get(fontName) as { name?: string } | undefined;
    return font?.name;
  } catch {
    return undefined;
  }
}

export function isBoldFont(name: string | undefined): boolean {
  return typeof name === "string" && /bold/i.test(name);
}
