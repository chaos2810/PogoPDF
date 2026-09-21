import { PDFName, PDFRef } from "pdf-lib";
import { RemoveMetadataInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { applyInfoFields, INFO_FIELDS } from "./editmetadata";

/**
 * Strips both metadata surfaces: the trailer /Info dict (all eight fields,
 * including CreationDate/ModDate) and the catalog's XMP /Metadata stream that
 * external producers write. pdf-lib does not author XMP, but files from other
 * applications do - the key is removed unconditionally, which is a no-op when
 * absent. When the XMP stream is an indirect object, it is deleted from the
 * context too: dropping only the catalog key leaves the stream serialized, so
 * the XMP bytes would still be recoverable in the output.
 */
export async function runRemoveMetadata(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath } = RemoveMetadataInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath, { updateMetadata: false });

  const cleared: Partial<Record<keyof typeof INFO_FIELDS, null>> = {};
  for (const name of Object.keys(INFO_FIELDS)) {
    cleared[name as keyof typeof INFO_FIELDS] = null;
  }
  applyInfoFields(doc, cleared);

  const xmp = doc.catalog.get(PDFName.of("Metadata"));
  doc.catalog.delete(PDFName.of("Metadata"));
  if (xmp instanceof PDFRef) doc.context.delete(xmp);

  return savePdf(doc, outDir, "no-metadata.pdf");
}
