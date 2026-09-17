import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PdfToMarkdownInputSchema, parsePageSelection } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { openRenderer } from "../convertout/shared";
import {
  clusterLines,
  isBoldFont,
  readPageItems,
  resolveFontName,
  type TextItem,
} from "./textitems";

/** Most frequent glyph height on the page, i.e. the body text size. */
function bodySize(items: TextItem[]): number {
  const counts = new Map<number, number>();
  for (const item of items) {
    const key = Math.round(item.height);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = 12;
  let bestCount = -1;
  for (const [size, count] of counts) {
    if (count > bestCount || (count === bestCount && size > best)) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

function lineText(line: TextItem[], fonts: Map<TextItem, string | undefined>): string {
  const parts = line.map((item) => {
    const text = item.str.trim();
    if (!text) return "";
    return isBoldFont(fonts.get(item)) ? `**${text}**` : text;
  });
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function plainText(line: TextItem[]): string {
  return line
    .map((item) => item.str.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function bulletText(line: TextItem[], fonts: Map<TextItem, string | undefined>): string | undefined {
  const raw = lineText(line, fonts);
  const match = /^([-•*])\s+(.*)$/.exec(raw);
  return match ? match[2] : undefined;
}

async function pageToMarkdown(page: PDFPageProxy): Promise<string> {
  // Fonts are only resolvable after the operator-list pass populates the
  // page's common object store; read items after it, not before.
  await page.getOperatorList();
  const items = await readPageItems(page);
  if (items.length === 0) return "";

  const fonts = new Map<TextItem, string | undefined>();
  for (const item of items) fonts.set(item, resolveFontName(page, item.fontName));

  const body = bodySize(items);
  const lines = clusterLines(items);
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push(paragraph.join(" "));
      paragraph = [];
    }
  };

  let prevY: number | undefined;
  for (const line of lines) {
    const maxHeight = Math.max(...line.map((item) => item.height));
    const y = line[0].y;

    const bullet = bulletText(line, fonts);
    if (bullet !== undefined) {
      flush();
      blocks.push(`- ${bullet}`);
      prevY = y;
      continue;
    }

    if (maxHeight >= body * 2) {
      flush();
      blocks.push(`# ${plainText(line)}`);
      prevY = y;
      continue;
    }
    if (maxHeight >= body * 1.5) {
      flush();
      blocks.push(`## ${plainText(line)}`);
      prevY = y;
      continue;
    }

    if (prevY !== undefined && Math.abs(prevY - y) > body * 1.5) flush();
    paragraph.push(lineText(line, fonts));
    prevY = y;
  }
  flush();

  return blocks.filter((block) => block.length > 0).join("\n\n");
}

/**
 * v1 Markdown export derives structure from pdf.js font-size heuristics: the
 * page's most common glyph height is treated as body text, runs at least 1.5x
 * that become h2 and at least 2x become h1. Gaps between lines start new
 * paragraphs and leading bullet glyphs become list items. Bold fonts are wrapped
 * in `**`. The structure is an approximation, not a reconstruction of the
 * original document.
 */
export async function runPdfToMarkdown(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, pages } = PdfToMarkdownInputSchema.parse(input);
  assertNotCancelled(ctx);

  const renderer = await openRenderer(filePath);
  try {
    const selected =
      pages === undefined
        ? Array.from({ length: renderer.pageCount }, (_, i) => i)
        : parsePageSelection(pages, renderer.pageCount);
    const sections: string[] = [];

    for (let n = 0; n < selected.length; n++) {
      assertNotCancelled(ctx);
      const page = await renderer.getPage(selected[n]);
      const section = await pageToMarkdown(page);
      if (section) sections.push(section);
      const done = n + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / selected.length) * 100),
        stage: "converting",
        pagesDone: done,
      });
    }

    const outPath = join(outDir, `${basename(filePath, extname(filePath))}.md`);
    await writeFile(outPath, sections.join("\n\n") + "\n");
    return outPath;
  } finally {
    await renderer.close();
  }
}
