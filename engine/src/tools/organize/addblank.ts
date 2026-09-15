import { AddBlankPageInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadPdf, savePdf } from "../pdfdoc";
import { assertNotCancelled, buildFromPages, invalidInput } from "./organize";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

export async function runAddBlankPage(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, position, size, orientation } =
    AddBlankPageInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = await loadPdf(filePath);
  const count = src.getPageCount();
  if (position > count) {
    throw invalidInput(`Position ${position} out of range (0-${count})`);
  }

  const dims: [number, number] =
    size === "match"
      ? [src.getPage(0).getWidth(), src.getPage(0).getHeight()]
      : orientation === "landscape"
        ? [A4_HEIGHT, A4_WIDTH]
        : [A4_WIDTH, A4_HEIGHT];

  const out = await buildFromPages(
    src,
    src.getPageIndices().map((index) => ({ index }))
  );
  out.insertPage(position, dims);
  return savePdf(out, outDir, "blank-added.pdf");
}
