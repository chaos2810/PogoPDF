import { PDFDict, PDFName, PDFRef } from "pdf-lib";
import { ANNOTATION_TYPES, RemoveAnnotationsInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";

type AnnotationType = (typeof ANNOTATION_TYPES)[number];

/**
 * The model annotation type mapped to the /Subtype value editorSave writes.
 * Both `line` and `arrow` map to /Line (an arrow is a main line plus two leg
 * lines), `rect` to /Square and `ellipse` to /Circle. The model-only types
 * (`redact`, `text`, `image`) have entries only so the map stays total over
 * ANNOTATION_TYPES; they are not written as annots by editorSave.
 */
const SUBTYPE_BY_TYPE: Record<AnnotationType, string> = {
  text: "FreeText",
  highlight: "Highlight",
  underline: "Underline",
  strikeout: "StrikeOut",
  rect: "Square",
  ellipse: "Circle",
  line: "Line",
  arrow: "Line",
  freehand: "Ink",
  redact: "Redact",
  image: "Stamp",
  freetext: "FreeText",
};

/**
 * Strip annotations from every page, optionally filtered by the model type.
 *
 * `types` semantics: an OMITTED list and an EMPTY list both mean remove
 * everything (default-all). An empty array is the shape a UI checkbox list
 * produces when nothing is checked, and treating it as "remove nothing" would
 * silently make the tool a no-op, so it is defined as remove-all. A non-empty
 * list keeps every other annotation, including unmapped types such as links.
 */
export async function runRemoveAnnotations(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, types } = RemoveAnnotationsInputSchema.parse(input);
  assertNotCancelled(ctx);

  const removeAll = types === undefined || types.length === 0;
  const wanted = new Set<string>(
    removeAll ? [] : types.map((t) => SUBTYPE_BY_TYPE[t])
  );

  // A cleanup tool should not rewrite the document's Producer/ModDate, so read
  // the real metadata values and leave them as they were.
  const doc = await loadPdf(filePath, { updateMetadata: false });
  const pageCount = doc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    assertNotCancelled(ctx);
    const page = doc.getPage(i);
    const annots = page.node.Annots();
    if (!annots) continue;
    // Walk backwards so removing an entry never shifts a later index.
    for (let j = annots.size() - 1; j >= 0; j--) {
      const entry = annots.get(j);
      const dict = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
      const subtype =
        dict instanceof PDFDict
          ? dict.get(PDFName.of("Subtype"))?.toString().replace(/^\//, "")
          : undefined;
      if (removeAll || (subtype !== undefined && wanted.has(subtype))) {
        annots.remove(j);
      }
    }
    if (annots.size() === 0) page.node.delete(PDFName.of("Annots"));
  }

  return savePdf(doc, outDir, "clean.pdf");
}
