import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { SearchInputSchema } from "@pogopdf/contracts";
import type { SearchData } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { readPageItems } from "../richcontent/textitems";
import { openRenderer } from "../convertout/shared";

export type { SearchData };

/** Hard cap on returned matches so a huge document cannot flood the UI. */
const MAX_MATCHES = 500;
/** Characters of context kept on each side of a match. */
const CONTEXT = 30;

type PageText = {
  text: string;
  /** Character offset where each item's run begins in `text`. */
  starts: number[];
  items: Array<{ str: string; x: number; y: number }>;
};

/**
 * Join a page's text runs with single spaces and remember where each run
 * begins, so a match's offset can be traced back to the item that carries its
 * position.
 */
async function joinPageItems(page: PDFPageProxy): Promise<PageText> {
  const items = await readPageItems(page);
  const starts: number[] = [];
  const parts: string[] = [];
  let offset = 0;
  for (const item of items) {
    starts.push(offset);
    parts.push(item.str);
    offset += item.str.length + 1;
  }
  return { text: parts.join(" "), starts, items };
}

/**
 * Extend a context window out to whole words: the start moves left and the end
 * moves right until both sit on a whitespace boundary. The window already
 * brackets the match, so this only ever grows it outward.
 */
function wordBoundaries(text: string, start: number, end: number): [number, number] {
  let s = start;
  while (s > 0 && !/\s/.test(text[s - 1])) s--;
  let e = end;
  while (e < text.length && !/\s/.test(text[e - 1])) e++;
  return [s, e];
}

/**
 * Case-insensitive substring search over every page's extracted text. Each hit
 * carries a context snippet plus the position of the item that starts it, in
 * the page's displayed frame. No hits is an empty DataResult, not an error.
 */
export async function runSearch(
  input: unknown,
  ctx: RpcCtx,
  _outDir: string
): Promise<SearchData> {
  const { filePath, query } = SearchInputSchema.parse(input);
  assertNotCancelled(ctx);

  const renderer = await openRenderer(filePath);
  try {
    const needle = query.toLowerCase();
    const matches: SearchData["matches"] = [];

    for (let i = 0; i < renderer.pageCount; i++) {
      assertNotCancelled(ctx);
      const page = await renderer.getPage(i);
      const { text, starts, items } = await joinPageItems(page);
      const haystack = text.toLowerCase();
      const viewport = page.getViewport({ scale: 1 });

      let from = 0;
      while (matches.length < MAX_MATCHES) {
        const at = haystack.indexOf(needle, from);
        if (at === -1) break;
        const end = at + needle.length;

        // The item containing the first character of the match.
        let itemIndex = 0;
        for (let k = starts.length - 1; k >= 0; k--) {
          if (starts[k] <= at) {
            itemIndex = k;
            break;
          }
        }
        const anchor = items[itemIndex] ?? items[0];
        const [dx, dy] = viewport.convertToViewportPoint(anchor.x, anchor.y);
        // The window already includes the match; grow it out to word edges.
        const [s, e] = wordBoundaries(
          text,
          Math.max(0, at - CONTEXT),
          Math.min(text.length, end + CONTEXT)
        );

        matches.push({
          page: i + 1,
          snippet: text.slice(s, e).trim(),
          x: dx,
          y: dy,
        });
        from = end;
      }

      const done = i + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / renderer.pageCount) * 100),
        stage: "searching",
        pagesDone: done,
      });
      if (matches.length >= MAX_MATCHES) break;
    }

    return { matches };
  } finally {
    await renderer.close();
  }
}
