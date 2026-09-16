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
 * Extract the text of every selected page, joined with form-feed separators.
 * `selected` defaults to all pages (0-based indices). `onPage` is called with
 * the page index and its position in the selection once each page is done;
 * `beforePage` runs before each page is read (cancellation checks).
 */
export async function extractAllText(
  renderer: PdfRenderer,
  selected?: number[],
  onPage?: (pageIndex: number, position: number) => void,
  beforePage?: () => void
): Promise<string> {
  const indices =
    selected ?? Array.from({ length: renderer.pageCount }, (_, i) => i);
  const pages: string[] = [];
  for (let n = 0; n < indices.length; n++) {
    beforePage?.();
    const page = await renderer.getPage(indices[n]);
    pages.push(await extractPageText(page));
    onPage?.(indices[n], n);
  }
  return pages.join("\f");
}
