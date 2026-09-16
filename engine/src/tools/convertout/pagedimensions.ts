import { PageDimensionsInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf } from "../pdfdoc";

const PT_TO_MM = 25.4 / 72;

export type PageDimensionsData = {
  pages: Array<{
    widthPt: number;
    heightPt: number;
    widthMm: number;
    heightMm: number;
    orientation: "portrait" | "landscape";
    rotation: number;
    displayed: { width: number; height: number };
  }>;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function runPageDimensions(
  input: unknown,
  ctx: RpcCtx,
  _outDir: string
): Promise<PageDimensionsData> {
  const { filePath } = PageDimensionsInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath);
  const pages: PageDimensionsData["pages"] = [];

  for (let i = 0; i < doc.getPageCount(); i++) {
    assertNotCancelled(ctx);
    const { width: widthPt, height: heightPt } = doc.getPage(i).getSize();
    const rotation = doc.getPage(i).getRotation().angle;
    // /Rotate 90/270 turns the page in the viewer, so the box the user sees
    // swaps width and height even though the MediaBox is unchanged.
    const swaps = rotation === 90 || rotation === 270;
    const displayed = swaps
      ? { width: heightPt, height: widthPt }
      : { width: widthPt, height: heightPt };

    pages.push({
      widthPt,
      heightPt,
      widthMm: round1(widthPt * PT_TO_MM),
      heightMm: round1(heightPt * PT_TO_MM),
      orientation: displayed.width > displayed.height ? "landscape" : "portrait",
      rotation,
      displayed,
    });
  }

  return { pages };
}
