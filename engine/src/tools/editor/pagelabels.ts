import { PDFDict, PDFHexString, PDFName, PDFNumber } from "pdf-lib";
import { PageLabelsInputSchema } from "@pogopdf/contracts";
import type { PageLabelsInput } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";

type Style = PageLabelsInput["style"];

/** Model style -> the /PageLabel /S name value (absent for none). */
const STYLE_NAME: Record<Exclude<Style, "none">, string> = {
  decimal: "D",
  "roman-upper": "R",
  "roman-lower": "r",
  "letters-upper": "A",
  "letters-lower": "a",
};

const PAGE_LABELS = PDFName.of("PageLabels");
const NUMS = PDFName.of("Nums");
const S = PDFName.of("S");
const ST = PDFName.of("St");
const P = PDFName.of("P");

/**
 * Writes the catalog /PageLabels number tree: one node covering page 1 with
 * /S (style), /St (start) and an optional /P prefix. Styles the document labels
 * itself; page rotation is irrelevant because labels are document-level.
 */
export async function runPageLabels(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, style, start, prefix } = PageLabelsInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath, { updateMetadata: false });
  const context = doc.context;

  const node = context.obj({}) as PDFDict;
  if (style === "none") {
    // No /S means unnumbered pages; the prefix alone still names them.
    if (prefix.length > 0) node.set(P, PDFHexString.fromText(prefix));
  } else {
    node.set(S, PDFName.of(STYLE_NAME[style]));
    node.set(ST, PDFNumber.of(start));
    if (prefix.length > 0) node.set(P, PDFHexString.fromText(prefix));
  }

  const tree = context.obj({}) as PDFDict;
  tree.set(NUMS, context.obj([0, context.register(node)]));
  doc.catalog.set(PAGE_LABELS, context.register(tree));

  return savePdf(doc, outDir, "labeled.pdf");
}
