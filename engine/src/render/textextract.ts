import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfRenderer } from "./renderpdf";

/** Join a page's text items with spaces and collapse whitespace runs. */
export async function extractPageText(page: PDFPageProxy): Promise<string> {
  const { items } = await page.getTextContent();
  const pieces: string[] = [];
  for (const item of items) {
    if ("str" in item && typeof item.str === "string") pieces.push(item.str);
  }
  return pieces.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Extract every page's text, joined with form-feed separators.
 * `onPage` is called with the 0-based page index once each page is done.
 */
export async function extractAllText(
  renderer: PdfRenderer,
  onPage?: (pageIndex: number) => void
): Promise<string> {
  const pages: string[] = [];
  for (let i = 0; i < renderer.pageCount; i++) {
    const page = await renderer.getPage(i);
    pages.push(await extractPageText(page));
    onPage?.(i);
  }
  return pages.join("\f");
}
