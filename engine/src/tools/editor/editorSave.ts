import { EditorSaveInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { writeAnnotations, redactedPages } from "./annotations";
import { applyRedactions } from "./redact";

/**
 * One save job per editor session. With no redact rects the annotations are
 * written as real PDF annotation dictionaries and the file is saved in place
 * (edited.pdf). With any redact rect the redaction branch runs instead, so the
 * marked content is genuinely removed rather than covered.
 */
export async function runEditorSave(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, annotations } = EditorSaveInputSchema.parse(input);
  assertNotCancelled(ctx);

  if (redactedPages(annotations).size > 0) {
    return applyRedactions(filePath, annotations, outDir, ctx);
  }

  const doc = await loadPdf(filePath);
  await writeAnnotations(doc, annotations, ctx);
  return savePdf(doc, outDir, "edited.pdf");
}
