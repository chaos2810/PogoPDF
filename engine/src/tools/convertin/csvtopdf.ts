import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { CsvToPdfInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled, invalidInput } from "../organize/organize";
import { buildPdf, readTextFile } from "../../textpdf/docbuilder";

// The schema has no margin field, so the table uses a fixed page margin.
const TABLE_MARGIN = 36;
const MIN_COL_WIDTH = 40;
const CELL_PADDING = 2;
const ROW_HEIGHT_FACTOR = 1.6;
const HEADER_BG = "#d9d9d9";
const STRIPE_BG = "#f7f7f7";

/** v1 renders only the first line of a cell; embedded newlines are dropped. */
function firstLine(cell: string | undefined): string {
  return (cell ?? "").split(/\r?\n/, 1)[0];
}

export async function runCsvToPdf(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, fontSize, orientation } = CsvToPdfInputSchema.parse(input);
  assertNotCancelled(ctx);

  const text = await readTextFile(filePath);

  let rows: string[][];
  try {
    rows = parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true });
  } catch (e) {
    throw invalidInput(`CSV parse error: ${(e as Error).message}`);
  }
  if (rows.length === 0) throw invalidInput("CSV file is empty");

  // v1 always treats the first row as the header; data rows are normalised to
  // the header's column count (missing cells empty, extras dropped).
  const header = rows[0].map(firstLine);
  const dataRows = rows.slice(1).map((row) => header.map((_, c) => firstLine(row[c])));
  const columnCount = header.length;
  const rowHeight = Math.round(fontSize * ROW_HEIGHT_FACTOR);

  const bytes = await buildPdf({ fontSize, margins: TABLE_MARGIN, layout: orientation }, (doc) => {
    const left = doc.page.margins.left;
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Measure the widest cell per column (bold for the header, regular for the
    // data), then shrink proportionally if the table outgrows the page.
    doc.font("Helvetica-Bold").fontSize(fontSize);
    const headerWidths = header.map((cell) => doc.widthOfString(cell));
    doc.font("Helvetica").fontSize(fontSize);
    const dataWidths = Array.from({ length: columnCount }, (_, c) =>
      dataRows.reduce((max, row) => Math.max(max, doc.widthOfString(row[c])), 0)
    );
    const desired = headerWidths.map((w, c) =>
      Math.max(MIN_COL_WIDTH, Math.max(w, dataWidths[c]) + CELL_PADDING * 2)
    );
    const desiredTotal = desired.reduce((sum, w) => sum + w, 0);
    const scale = desiredTotal > contentWidth ? contentWidth / desiredTotal : 1;
    const colWidths = desired.map((w) => w * scale);
    const tableWidth = colWidths.reduce((sum, w) => sum + w, 0);

    const lineHeight = (font: string): number => {
      doc.font(font).fontSize(fontSize);
      return doc.currentLineHeight();
    };
    const headerLineHeight = lineHeight("Helvetica-Bold");
    const dataLineHeight = lineHeight("Helvetica");

    const drawRow = (cells: string[], y: number, font: string, background?: string) => {
      if (background) doc.rect(left, y, tableWidth, rowHeight).fill(background);
      const lh = font === "Helvetica-Bold" ? headerLineHeight : dataLineHeight;
      const textY = y + (rowHeight - lh) / 2;
      let x = left;
      for (let c = 0; c < columnCount; c++) {
        const width = colWidths[c];
        const textWidth = Math.max(1, width - CELL_PADDING * 2);
        doc
          .font(font)
          .fontSize(fontSize)
          .fillColor("black")
          .text(cells[c], x + CELL_PADDING, textY, {
            width: textWidth,
            height: rowHeight,
            ellipsis: true,
          });
        x += width;
      }
    };

    const drawHeader = (y: number) => drawRow(header, y, "Helvetica-Bold", HEADER_BG);

    let y = doc.page.margins.top;
    drawHeader(y);
    y += rowHeight;
    for (let i = 0; i < dataRows.length; i++) {
      assertNotCancelled(ctx);
      if (y + rowHeight > pageBottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader(y);
        y += rowHeight;
      }
      drawRow(dataRows[i], y, "Helvetica", i % 2 === 1 ? STRIPE_BG : undefined);
      y += rowHeight;
    }
  });

  const outPath = join(outDir, `${basename(filePath, extname(filePath))}.pdf`);
  await writeFile(outPath, bytes);
  return outPath;
}
