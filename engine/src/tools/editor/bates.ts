import {
  BatesNumberInputSchema,
  parsePageSelection,
} from "@pogopdf/contracts";
import type { BatesNumberInput, ProgressParams } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { drawPageText, embedStandardFont } from "../edit/pagedraw";

/**
 * Bates numbering counts its own per-file sequence: the value follows the
 * page's position within the selection, not the document page index. The
 * prefix joins the sequence with a hyphen for prefix-n (e.g. "CASE-5"); for
 * n-of-total the prefix is concatenated bare (e.g. "EX5 / 30").
 */
export function formatBates(
  format: BatesNumberInput["format"],
  prefix: string,
  num: number,
  total: number
): string {
  switch (format) {
    case "n":
      return String(num);
    case "prefix-n":
      return `${prefix}-${num}`;
    case "n-of-total":
      return `${prefix}${num} / ${total}`;
  }
}

export async function runBates(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, position, format, prefix, startNumber, fontSize, margin, pages } =
    BatesNumberInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath);
  const pageCount = doc.getPageCount();
  const font = await embedStandardFont(doc);

  const selected =
    pages === undefined ? doc.getPageIndices() : parsePageSelection(pages, pageCount);
  const total = selected.length;

  for (let n = 0; n < total; n++) {
    assertNotCancelled(ctx);
    const num = startNumber + n;
    drawPageText(doc, selected[n], formatBates(format, prefix, num, total), font, {
      position,
      fontSize,
      margin,
    });
    const done = n + 1;
    ctx.notifyProgress({
      jobId: "",
      percent: Math.round((done / total) * 100),
      stage: "numbering",
      pagesDone: done,
    } satisfies ProgressParams);
  }

  return savePdf(doc, outDir, "bates.pdf");
}
