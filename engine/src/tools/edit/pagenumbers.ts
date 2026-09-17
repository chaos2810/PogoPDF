import {
  PageNumbersInputSchema,
  parsePageSelection,
} from "@pogopdf/contracts";
import type { PageNumbersInput, ProgressParams } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { drawPageText, embedStandardFont } from "./pagedraw";

/**
 * The displayed number follows the DOCUMENT page, not the position in the
 * selection: numbering "pages 3-5" with startNumber 1 yields 3, 4, 5. The
 * "n-of-total" denominator is likewise the full document page count.
 */
function formatNumber(
  format: PageNumbersInput["format"],
  num: number,
  total: number
): string {
  switch (format) {
    case "n":
      return String(num);
    case "n-of-total":
      return `${num} / ${total}`;
    case "page-n":
      return `Page ${num}`;
  }
}

export async function runPageNumbers(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, position, format, startNumber, fontSize, margin, pages, skipFirst } =
    PageNumbersInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath);
  const pageCount = doc.getPageCount();
  const font = await embedStandardFont(doc);

  let selected =
    pages === undefined
      ? doc.getPageIndices()
      : parsePageSelection(pages, pageCount);
  if (skipFirst) selected = selected.filter((index) => index !== 0);

  for (let n = 0; n < selected.length; n++) {
    assertNotCancelled(ctx);
    const index = selected[n];
    const num = startNumber + index;
    drawPageText(doc, index, formatNumber(format, num, pageCount), font, {
      position,
      fontSize,
      margin,
    });
    const done = n + 1;
    ctx.notifyProgress({
      jobId: "",
      percent: Math.round((done / selected.length) * 100),
      stage: "numbering",
      pagesDone: done,
    } satisfies ProgressParams);
  }

  return savePdf(doc, outDir, "numbered.pdf");
}
