import { PDFDocument } from "pdf-lib";
import { ImagesToPdfInputSchema } from "@pogopdf/contracts";
import type { ImagesToPdfInput } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadImageEmbeddable } from "../../render/decode";
import { assertNotCancelled } from "../organize/organize";
import { savePdf } from "../pdfdoc";

// Portrait dimensions in points (ISO 216 / US Letter at 72 dpi).
const SIZES: Record<Exclude<ImagesToPdfInput["pageSize"], "fit">, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** Keep a degenerate (image smaller than 2x margin) box drawable. */
const MIN_BOX_PT = 1;

/** Scale an image to fit a box, centred; returns the drawn box. */
function fitInto(
  imageW: number,
  imageH: number,
  boxW: number,
  boxH: number,
  pageW: number,
  pageH: number
) {
  const scale = Math.min(boxW / imageW, boxH / imageH);
  const width = imageW * scale;
  const height = imageH * scale;
  return { x: (pageW - width) / 2, y: (pageH - height) / 2, width, height };
}

export async function runImagesToPdf(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePaths, pageSize, orientation, margin } = ImagesToPdfInputSchema.parse(input);
  assertNotCancelled(ctx);

  const out = await PDFDocument.create();

  for (let i = 0; i < filePaths.length; i++) {
    assertNotCancelled(ctx);
    const { bytes, kind, widthPx, heightPx } = await loadImageEmbeddable(filePaths[i]);
    const image = kind === "jpg" ? await out.embedJpg(bytes) : await out.embedPng(bytes);

    if (pageSize === "fit") {
      // Page = image pixels interpreted 1:1 as points; margin insets the image
      // only (the page never shrinks below the image's own size).
      const pageW = widthPx;
      const pageH = heightPx;
      const inset = Math.min(margin, (pageW - MIN_BOX_PT) / 2, (pageH - MIN_BOX_PT) / 2);
      const box = fitInto(
        widthPx,
        heightPx,
        pageW - inset * 2,
        pageH - inset * 2,
        pageW,
        pageH
      );
      const page = out.addPage([pageW, pageH]);
      page.drawImage(image, box);
    } else {
      const [w, h] = SIZES[pageSize];
      const pageW = orientation === "landscape" ? h : w;
      const pageH = orientation === "landscape" ? w : h;
      const box = fitInto(
        widthPx,
        heightPx,
        pageW - margin * 2,
        pageH - margin * 2,
        pageW,
        pageH
      );
      const page = out.addPage([pageW, pageH]);
      page.drawImage(image, box);
    }

    const done = i + 1;
    ctx.notifyProgress({
      jobId: "",
      percent: Math.round((done / filePaths.length) * 100),
      stage: "converting",
      pagesDone: done,
    });
  }

  return savePdf(out, outDir, "images.pdf");
}
