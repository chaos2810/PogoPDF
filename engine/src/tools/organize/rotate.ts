import {
  RotateCustomInputSchema,
  RotateInputSchema,
  parsePageSelection,
} from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled, buildFromPages, invalidInput, normalizeAngle } from "./organize";

export async function runRotate(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, angle, pages } = RotateInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const all = src.getPageIndices();
  const selected = new Set(
    pages === undefined ? all : parsePageSelection(pages, src.getPageCount())
  );
  // Absolute SET: selected pages get `angle`, the rest keep their existing /Rotate.
  const out = await buildFromPages(
    src,
    all.map((index) => (selected.has(index) ? { index, rotate: angle } : { index }))
  );
  return savePdf(out, outDir, "rotated.pdf");
}

export async function runRotateCustom(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, angle } = RotateCustomInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const out = await buildFromPages(
    src,
    src.getPageIndices().map((index) => {
      const next = normalizeAngle(src.getPage(index).getRotation().angle + angle);
      // pdf-lib only accepts /Rotate multiples of 90; reject rather than throw untyped.
      if (next % 90 !== 0) {
        throw invalidInput(`Custom rotation delta ${angle} is not a multiple of 90`);
      }
      return { index, rotate: next as 0 | 90 | 180 | 270 };
    })
  );
  return savePdf(out, outDir, "rotated-custom.pdf");
}
