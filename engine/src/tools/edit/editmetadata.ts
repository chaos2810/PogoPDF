import { PDFDict, PDFHexString, PDFName } from "pdf-lib";
import type { PDFDocument } from "pdf-lib";
import { EditMetadataInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";

/** Field name -> info-dict key. */
export const INFO_FIELDS: Record<string, PDFName> = {
  title: PDFName.of("Title"),
  author: PDFName.of("Author"),
  subject: PDFName.of("Subject"),
  keywords: PDFName.of("Keywords"),
  creator: PDFName.of("Creator"),
  producer: PDFName.of("Producer"),
  creationDate: PDFName.of("CreationDate"),
  modificationDate: PDFName.of("ModDate"),
};

/**
 * The document's /Info dict, created on demand. pdf-lib keeps `getInfoDict`
 * private, so this mirrors its implementation: the trailer /Info ref when it
 * resolves to a dict, otherwise a freshly registered empty dict.
 */
export function infoDict(doc: PDFDocument): PDFDict {
  const existing = doc.context.lookup(doc.context.trailerInfo.Info);
  if (existing instanceof PDFDict) return existing;
  const created = doc.context.obj({});
  doc.context.trailerInfo.Info = doc.context.register(created);
  return created;
}

/**
 * Set or remove info-dict fields. `undefined` leaves a field alone, `null`
 * deletes the key, a string writes it. Values go through PDFHexString.fromText
 * (the same encoding pdf-lib's own setters use), so non-ASCII round-trips.
 * pdf-lib's save() does not touch metadata (updateInfoDict only runs on load
 * with updateMetadata:true), so loading with updateMetadata:false and saving
 * leaves untouched fields — and the dates — exactly as they were.
 */
export function applyInfoFields(
  doc: PDFDocument,
  changes: Partial<Record<keyof typeof INFO_FIELDS, string | null>>
): void {
  const info = infoDict(doc);
  for (const [name, key] of Object.entries(INFO_FIELDS)) {
    const value = changes[name as keyof typeof INFO_FIELDS];
    if (value === undefined) continue;
    if (value === null) info.delete(key);
    else info.set(key, PDFHexString.fromText(value));
  }
}

export async function runEditMetadata(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, title, author, subject, keywords, creator, producer } =
    EditMetadataInputSchema.parse(input);
  assertNotCancelled(ctx);

  // updateMetadata:false keeps the file's real /Producer and dates in memory so
  // that only the requested fields change.
  const doc = await loadPdf(filePath, { updateMetadata: false });
  applyInfoFields(doc, { title, author, subject, keywords, creator, producer });

  return savePdf(doc, outDir, "metadata.pdf");
}
