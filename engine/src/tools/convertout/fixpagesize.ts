import { PDFDocument } from "pdf-lib";
import { FixPageSizeInputSchema } from "@pogopdf/contracts";
import type { FixPageSizeInput } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";

// Portrait dimensions in points (ISO 216 / US Letter at 72 dpi).
const SIZES: Record<FixPageSizeInput["size"], [number, number]> = {
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
  letter: [612, 792],
};

export async function runFixPageSize(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, size, orientation, fit } = FixPageSizeInputSchema.parse(input);
  assertNotCancelled(ctx);

  const [w, h] = SIZES[size];
  const targetW = orientation === "landscape" ? h : w;
  const targetH = orientation === "landscape" ? w : h;

  const src = await loadPdf(filePath);
  const out = await PDFDocument.create();
  const embedded = await out.embedPages(src.getPages());

  for (let i = 0; i < embedded.length; i++) {
    assertNotCancelled(ctx);
    const emb = embedded[i];
    const page = out.addPage([targetW, targetH]);

    // scale: always fit (may upscale). pad: fit only when the source overflows,
    // otherwise draw at 1:1 so smaller pages keep their true size.
    const fitScale = Math.min(targetW / emb.width, targetH / emb.height);
    const scale = fit === "scale" ? fitScale : Math.min(1, fitScale);
    const drawW = emb.width * scale;
    const drawH = emb.height * scale;

    page.drawPage(emb, {
      x: (targetW - drawW) / 2,
      y: (targetH - drawH) / 2,
      xScale: scale,
      yScale: scale,
    });
  }

  return savePdf(out, outDir, "resized.pdf");
}
