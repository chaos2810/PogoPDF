import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ExtractTablesInputSchema, parsePageSelection, TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { openRenderer } from "../convertout/shared";
import { clusterLines, readPageItems, type TextItem } from "./textitems";

export type TablePage = { page: number; rows: string[][] };

export function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

/** GFM pipe tables need a literal pipe in a cell escaped as `\|`. */
function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function toMarkdown(pages: TablePage[]): string {
  return pages
    .map(({ rows }) => {
      const [header, ...body] = rows;
      const align = `| ${header.map(() => "---").join(" | ")} |`;
      const lines = body.map((row) => `| ${row.map(markdownCell).join(" | ")} |`);
      return [`| ${header.map(markdownCell).join(" | ")} |`, align, ...lines].join("\n");
    })
    .join("\n\n");
}

/**
 * Split one text line into cells at x gaps wider than 1.5x the line's average
 * character width. Words inside a cell stay joined with a space.
 */
function splitColumns(line: TextItem[]): string[] {
  const totalChars = line.reduce((sum, item) => sum + Math.max(1, item.str.trim().length), 0);
  const totalWidth = line.reduce((sum, item) => sum + item.width, 0);
  const avgCharWidth = totalChars > 0 ? totalWidth / totalChars : 12;
  const threshold = Math.max(3, avgCharWidth * 1.5);

  const cells: string[] = [];
  let parts: string[] = [];
  let prev: TextItem | undefined;
  for (const item of line) {
    if (prev && item.x - (prev.x + prev.width) > threshold) {
      cells.push(parts.join(" ").replace(/\s+/g, " ").trim());
      parts = [];
    }
    parts.push(item.str);
    prev = item;
  }
  cells.push(parts.join(" ").replace(/\s+/g, " ").trim());
  return cells.filter((cell) => cell.length > 0);
}

function detectTables(items: TextItem[]): string[][] {
  const rows: string[][] = [];
  for (const line of clusterLines(items)) {
    const cells = splitColumns(line);
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

/**
 * v1 table extraction: pdf.js text positions are clustered into rows by
 * baseline proximity and into columns by x gaps. It reads positioned text, not
 * ruled lines or cell borders, so it works best on simple, cleanly spaced
 * tables and can misread complex layouts. Pages with fewer than two detected
 * columns are skipped; if no page yields a table the job fails honestly with
 * UNSUPPORTED_FORMAT.
 */
export async function runExtractTables(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string | string[]> {
  const { filePath, pages, format } = ExtractTablesInputSchema.parse(input);
  assertNotCancelled(ctx);

  const renderer = await openRenderer(filePath);
  try {
    const selected =
      pages === undefined
        ? Array.from({ length: renderer.pageCount }, (_, i) => i)
        : parsePageSelection(pages, renderer.pageCount);
    const stem = basename(filePath, extname(filePath));
    const tables: TablePage[] = [];

    for (let n = 0; n < selected.length; n++) {
      assertNotCancelled(ctx);
      const page: PDFPageProxy = await renderer.getPage(selected[n]);
      const rows = detectTables(await readPageItems(page));
      if (rows.length > 0) tables.push({ page: selected[n] + 1, rows });
      const done = n + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / selected.length) * 100),
        stage: "extracting",
        pagesDone: done,
      });
    }

    if (tables.length === 0) {
      throw Object.assign(new Error("No tables detected in this file"), {
        code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT,
      });
    }

    if (format === "csv") {
      const out: string[] = [];
      for (let i = 0; i < tables.length; i++) {
        const outPath = join(outDir, `${stem}-${i + 1}.csv`);
        await writeFile(outPath, toCsv(tables[i].rows));
        out.push(outPath);
      }
      return out;
    }

    if (format === "markdown") {
      const outPath = join(outDir, "output.md");
      await writeFile(outPath, toMarkdown(tables));
      return outPath;
    }

    const outPath = join(outDir, "output.json");
    await writeFile(outPath, JSON.stringify({ pages: tables }, null, 2));
    return outPath;
  } finally {
    await renderer.close();
  }
}
