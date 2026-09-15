import { PDFDocument } from "pdf-lib";
import { DividePagesInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled } from "./organize";

// Each page is cut into `count` strips. The strip is produced by embedding the
// source page and drawing it translated so the strip region lands inside the
// output page; the output MediaBox acts as the clip (content outside a page box
// is not painted).
export async function runDivide(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, direction, count } = DividePagesInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const out = await PDFDocument.create();
  const embedded = await out.embedPages(src.getPages());

  embedded.forEach((emb) => {
    assertNotCancelled(ctx);
    const stripW =
      direction === "horizontal" ? emb.width / count : emb.width;
    const stripH =
      direction === "vertical" ? emb.height / count : emb.height;
    for (let i = 0; i < count; i++) {
      const page = out.addPage([stripW, stripH]);
      if (direction === "horizontal") {
        // vertical cuts, left-to-right
        page.drawPage(emb, { x: -i * stripW, y: 0 });
      } else {
        // horizontal cuts, top-to-bottom (PDF origin is bottom-left)
        page.drawPage(emb, { x: 0, y: -(count - 1 - i) * stripH });
      }
    }
  });

  return savePdf(out, outDir, "divided.pdf");
}
