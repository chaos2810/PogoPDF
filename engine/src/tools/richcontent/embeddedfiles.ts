import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  type PDFDocument,
} from "pdf-lib";

export type EmbeddedFileInfo = { name: string; size: number };

type Entry = { name: string; ref: PDFRef; filespec: PDFDict };

const NAMES = PDFName.of("Names");
const EMBEDDED_FILES = PDFName.of("EmbeddedFiles");
const AF = PDFName.of("AF");
const EF = PDFName.of("EF");
const F = PDFName.of("F");
const PARAMS = PDFName.of("Params");
const SIZE = PDFName.of("Size");

/**
 * Name-tree keys and file spec /F fields can be literal or hex strings. v1 only
 * traverses the flat root /Names array that pdf-lib's attach() writes; nested
 * /Kids subtrees are not walked (a real-world name tree with 50+ files is out of
 * scope for this tool).
 */
function decodeText(obj: unknown): string | undefined {
  if (obj instanceof PDFHexString || obj instanceof PDFString || obj instanceof PDFName) {
    return obj.decodeText();
  }
  return undefined;
}

function embeddedFilesRoot(doc: PDFDocument): PDFDict | undefined {
  const names = doc.catalog.lookupMaybe(NAMES, PDFDict);
  return names?.lookupMaybe(EMBEDDED_FILES, PDFDict);
}

function collectEntries(doc: PDFDocument): Entry[] {
  const root = embeddedFilesRoot(doc);
  if (!root) return [];
  const names = root.lookupMaybe(NAMES, PDFArray);
  if (!names) return [];

  const entries: Entry[] = [];
  for (let i = 0; i + 1 < names.size(); i += 2) {
    const name = decodeText(names.get(i));
    const ref = names.get(i + 1);
    if (name === undefined || !(ref instanceof PDFRef)) continue;
    entries.push({ name, ref, filespec: doc.context.lookup(ref, PDFDict) });
  }
  return entries;
}

/** The /EF /F entry, resolved to the raw embedded-file stream. */
function embeddedStream(doc: PDFDocument, filespec: PDFDict): PDFRawStream | undefined {
  const ef = filespec.lookupMaybe(EF, PDFDict);
  const f = ef?.get(F);
  if (f === undefined) return undefined;
  // lookupMaybe's overloads accept PDFStream but not its raw subclass, so look
  // up as PDFStream and narrow after.
  const stream =
    f instanceof PDFRawStream ? f : doc.context.lookupMaybe(f, PDFStream);
  return stream instanceof PDFRawStream ? stream : undefined;
}

/** Uncompressed size, preferring the embedded stream's /Params /Size. */
function sizeOf(doc: PDFDocument, filespec: PDFDict): number {
  const stream = embeddedStream(doc, filespec);
  if (!stream) return 0;
  const params = stream.dict.lookupMaybe(PARAMS, PDFDict);
  const size = params?.lookupMaybe(SIZE, PDFNumber);
  if (size) return size.asNumber();
  return decodePDFRawStream(stream).decode().length;
}

export function listEmbeddedFiles(doc: PDFDocument): EmbeddedFileInfo[] {
  return collectEntries(doc).map(({ name, filespec }) => ({
    name,
    size: sizeOf(doc, filespec),
  }));
}

export function getEmbeddedFile(doc: PDFDocument, name: string): Uint8Array | undefined {
  const entry = collectEntries(doc).find((e) => e.name === name);
  if (!entry) return undefined;
  const stream = embeddedStream(doc, entry.filespec);
  if (!stream) return undefined;
  return decodePDFRawStream(stream).decode();
}

/** Drops the matched /Names pair and its /AF reference. False when absent. */
export function removeEmbeddedFile(doc: PDFDocument, name: string): boolean {
  const root = embeddedFilesRoot(doc);
  const names = root?.lookupMaybe(NAMES, PDFArray);
  if (!names) return false;

  for (let i = 0; i + 1 < names.size(); i += 2) {
    if (decodeText(names.get(i)) !== name) continue;
    const ref = names.get(i + 1);
    names.remove(i + 1);
    names.remove(i);

    const af = doc.catalog.lookupMaybe(AF, PDFArray);
    if (af && ref instanceof PDFRef) {
      for (let j = af.size() - 1; j >= 0; j--) {
        if (af.get(j) === ref) af.remove(j);
      }
    }
    return true;
  }
  return false;
}
