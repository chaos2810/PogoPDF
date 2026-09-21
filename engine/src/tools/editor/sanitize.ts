import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { PDFArray, PDFDict, PDFName, PDFRef } from "pdf-lib";
import { SanitizeInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { applyInfoFields, INFO_FIELDS } from "../edit/editmetadata";
import { listEmbeddedFileEntries } from "../richcontent/embeddedfiles";
import { assertInputExists, runQpdf } from "../secure/qpdfbin";

const NAMES = PDFName.of("Names");
const EMBEDDED_FILES = PDFName.of("EmbeddedFiles");
const JAVASCRIPT = PDFName.of("JavaScript");
const METADATA = PDFName.of("Metadata");
const AF = PDFName.of("AF");
const EF = PDFName.of("EF");
const F = PDFName.of("F");

/** Deletes the trailer info fields, the catalog XMP stream, and its bytes. */
function stripMetadata(doc: Awaited<ReturnType<typeof loadPdf>>): void {
  const cleared: Partial<Record<keyof typeof INFO_FIELDS, null>> = {};
  for (const name of Object.keys(INFO_FIELDS)) {
    cleared[name as keyof typeof INFO_FIELDS] = null;
  }
  applyInfoFields(doc, cleared);
  const xmp = doc.catalog.get(METADATA);
  doc.catalog.delete(METADATA);
  // Removing only the key leaves the indirect stream object serialized, so an
  // XMP byte search still finds it; delete the object itself.
  if (xmp instanceof PDFRef) doc.context.delete(xmp);
}

/** Drops every /Annots array from every page (all subtypes, unfiltered). */
function stripAnnotations(doc: Awaited<ReturnType<typeof loadPdf>>): void {
  const annots = PDFName.of("Annots");
  for (let i = 0; i < doc.getPageCount(); i++) {
    doc.getPage(i).node.delete(annots);
  }
}

/** Removes a /Names subtree entry, pruning the now-empty /Names dict. */
function stripNamesEntry(doc: Awaited<ReturnType<typeof loadPdf>>, key: PDFName): void {
  const names = doc.catalog.lookupMaybe(NAMES, PDFDict);
  if (!names) return;
  names.delete(key);
  if (names.keys().length === 0) doc.catalog.delete(NAMES);
}

/**
 * Drops the EmbeddedFiles name tree and the catalog /AF file references. The
 * filespec refs and their /EF /F stream refs are captured first (the same tree
 * walk listEmbeddedFileEntries uses), then deleted from the context after the
 * tree is gone: an unreferenced indirect object is still serialized, so the
 * attachment bytes would otherwise stay recoverable in the output. This is a
 * byte-level scrub for both the filespec and the embedded stream.
 */
function stripAttachments(doc: Awaited<ReturnType<typeof loadPdf>>): void {
  const captured = new Set<PDFRef>();
  for (const entry of listEmbeddedFileEntries(doc)) {
    captured.add(entry.ref);
    const ef = entry.filespec.lookupMaybe(EF, PDFDict);
    const stream = ef?.get(F);
    if (stream instanceof PDFRef) captured.add(stream);
  }
  stripNamesEntry(doc, EMBEDDED_FILES);
  const af = doc.catalog.lookupMaybe(AF, PDFArray);
  if (af) {
    for (let i = af.size() - 1; i >= 0; i--) af.remove(i);
    doc.catalog.delete(AF);
  }
  for (const ref of captured) doc.context.delete(ref);
}

/**
 * Scrubs a document behind five independent flags. The metadata, annotation,
 * attachment and JavaScript passes run in pdf-lib; form flattening is the same
 * qpdf `--flatten-annotations=all` pass the secure flatten tool uses. The
 * flattened pass consumes the pdf-lib output as its input.
 *
 * Attachment and XMP removal are byte-level: their indirect objects are deleted
 * from the context, not merely unreferenced. The JavaScript pass is logical only
 * (the /Names /JavaScript subtree is dropped), so the now-unreferenced action
 * dicts and their /JS strings can still be recovered from the output. That is a
 * known gap, not an oversight.
 */
export async function runSanitize(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const {
    filePath,
    removeMetadata,
    removeAnnotations,
    removeAttachments,
    removeJavaScript,
    flattenForms,
  } = SanitizeInputSchema.parse(input);
  assertNotCancelled(ctx);
  assertInputExists(filePath);

  const doc = await loadPdf(filePath, { updateMetadata: false });
  if (removeMetadata) stripMetadata(doc);
  if (removeAnnotations) stripAnnotations(doc);
  if (removeAttachments) stripAttachments(doc);
  if (removeJavaScript) stripNamesEntry(doc, JAVASCRIPT);

  const outPath = join(outDir, "sanitized.pdf");
  if (!flattenForms) return savePdf(doc, outDir, "sanitized.pdf");

  const draft = await savePdf(doc, outDir, "sanitized-draft.pdf");
  try {
    await runQpdf(["--flatten-annotations=all", "--", draft, outPath], outDir);
  } finally {
    // The intermediate is internal, so it never lingers in the job dir.
    try {
      unlinkSync(draft);
    } catch {
      /* already gone or locked; the job dir is cleaned on engine exit */
    }
  }
  return outPath;
}
