import { PDFDocument } from "pdf-lib";
import { NupInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled } from "./organize";

const DEFAULT_MARGIN = 6;

// layout "CxR": cols=C, rows=R. Pages are grouped C*R at a time; each group
// becomes one output page. The FIRST page's size defines the cell unit for the
// whole document (mixed input sizes are scaled to fit that cell).
export async function runNup(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, layout, margin = DEFAULT_MARGIN } =
    NupInputSchema.parse(input);
  assertNotCancelled(ctx);

  const [cols, rows] = layout.split("x").map((n) => parseInt(n, 10));
  const src = await loadPdf(filePath);
  const count = src.getPageCount();
  if (count === 0) return savePdf(await PDFDocument.create(), outDir, "nup.pdf");

  const cellW = src.getPage(0).getWidth();
  const cellH = src.getPage(0).getHeight();
  const innerW = cellW - margin;
  const innerH = cellH - margin;
  const totalW = cols * cellW + (cols + 1) * margin;
  const totalH = rows * cellH + (rows + 1) * margin;

  const out = await PDFDocument.create();
  const embedded = await out.embedPages(src.getPages());
  const perPage = cols * rows;

  for (let start = 0; start < count; start += perPage) {
    assertNotCancelled(ctx);
    const page = out.addPage([totalW, totalH]);
    for (let i = 0; i < perPage && start + i < count; i++) {
      const emb = embedded[start + i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const scale = Math.min(innerW / emb.width, innerH / emb.height);
      const drawW = emb.width * scale;
      const drawH = emb.height * scale;
      // PDF origin is bottom-left; row 0 is the top row.
      const cellX = margin + col * (cellW + margin);
      const cellY = margin + (rows - 1 - row) * (cellH + margin);
      page.drawPage(emb, {
        x: cellX + (cellW - drawW) / 2,
        y: cellY + (cellH - drawH) / 2,
        xScale: scale,
        yScale: scale,
      });
    }
  }

  return savePdf(out, outDir, "nup.pdf");
}
