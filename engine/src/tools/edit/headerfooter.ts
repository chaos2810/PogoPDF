import { HeaderFooterInputSchema, parsePageSelection } from "@pogopdf/contracts";
import type { ProgressParams } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { drawPageText, embedStandardFont } from "./pagedraw";

export async function runHeaderFooter(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, header, footer, fontSize, margin, pages } =
    HeaderFooterInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath);
  const font = await embedStandardFont(doc);
  const selected =
    pages === undefined
      ? doc.getPageIndices()
      : parsePageSelection(pages, doc.getPageCount());

  const headerText = header?.trim();
  const footerText = footer?.trim();

  for (let n = 0; n < selected.length; n++) {
    assertNotCancelled(ctx);
    const index = selected[n];
    if (headerText) {
      drawPageText(doc, index, headerText, font, {
        position: "top-center",
        fontSize,
        margin,
      });
    }
    if (footerText) {
      drawPageText(doc, index, footerText, font, {
        position: "bottom-center",
        fontSize,
        margin,
      });
    }
    const done = n + 1;
    ctx.notifyProgress({
      jobId: "",
      percent: Math.round((done / selected.length) * 100),
      stage: "stamping",
      pagesDone: done,
    } satisfies ProgressParams);
  }

  return savePdf(doc, outDir, "header-footer.pdf");
}
