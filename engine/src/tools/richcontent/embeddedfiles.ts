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

/**
 * Entries carry their own filespec ref. Extraction must fetch by entry, not by
 * name: two attachments can share a basename, and a name lookup returns the
 * first match for both.
 */
export type EmbeddedFileEntry = {
  name: string;
  size: number;
  ref: PDFRef;
  filespec: PDFDict;
};

const NAMES = PDFName.of("Names");
const KIDS = PDFName.of("Kids");
const EMBEDDED_FILES = PDFName.of("EmbeddedFiles");
const AF = PDFName.of("AF");
const EF = PDFName.of("EF");
const F = PDFName.of("F");
const PARAMS = PDFName.of("Params");
const SIZE = PDFName.of("Size");

/**
 * Name-tree keys and file spec /F fields can be literal or hex strings. The
 * reader walks both the flat root /Names array pdf-lib writes and nested /Kids
 * subtrees (Acrobat portfolios). A kid whose /Names or /Kids value has the
 * wrong type is skipped rather than aborting the whole list.
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

/** Resolve a ref or direct object without pdf-lib's throwing type check. */
function resolve(doc: PDFDocument, obj: unknown): unknown {
  return obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
}

function resolveDict(doc: PDFDocument, obj: unknown): PDFDict | undefined {
  const value = resolve(doc, obj);
  return value instanceof PDFDict ? value : undefined;
}

function resolveArray(doc: PDFDocument, obj: unknown): PDFArray | undefined {
  const value = resolve(doc, obj);
  return value instanceof PDFArray ? value : undefined;
}

function pushPairs(doc: PDFDocument, names: PDFArray, out: EmbeddedFileEntry[]): void {
  for (let i = 0; i + 1 < names.size(); i += 2) {
    const name = decodeText(names.get(i));
    const ref = names.get(i + 1);
    if (name === undefined || !(ref instanceof PDFRef)) continue;
    const filespec = resolveDict(doc, ref);
    if (!filespec) continue;
    out.push({ name, size: sizeOf(doc, filespec), ref, filespec });
  }
}

function collectFromNode(doc: PDFDocument, node: PDFDict, out: EmbeddedFileEntry[]): void {
  const names = resolveArray(doc, node.get(NAMES));
  if (names) pushPairs(doc, names, out);

  const kids = resolveArray(doc, node.get(KIDS));
  if (!kids) return;
  for (let i = 0; i < kids.size(); i++) {
    const kid = resolveDict(doc, kids.get(i));
    if (!kid) continue;
    collectFromNode(doc, kid, out);
  }
}

function collectEntries(doc: PDFDocument): EmbeddedFileEntry[] {
  const root = embeddedFilesRoot(doc);
  if (!root) return [];
  const entries: EmbeddedFileEntry[] = [];
  collectFromNode(doc, root, entries);
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

/**
 * Entries with their filespec refs; use this when fetching bytes so duplicate
 * basenames resolve to their own streams. The public list RPC maps to
 * { name, size }.
 */
export function listEmbeddedFileEntries(doc: PDFDocument): EmbeddedFileEntry[] {
  return collectEntries(doc);
}

export function listEmbeddedFiles(doc: PDFDocument): EmbeddedFileInfo[] {
  return collectEntries(doc).map(({ name, size }) => ({ name, size }));
}

export function getEmbeddedFile(
  doc: PDFDocument,
  entry: EmbeddedFileEntry
): Uint8Array | undefined {
  const stream = embeddedStream(doc, entry.filespec);
  if (!stream) return undefined;
  return decodePDFRawStream(stream).decode();
}

/**
 * Drops the matched /Names pair and its /AF reference. False when absent.
 * Only the flat root /Names array is searched and only the FIRST entry with a
 * matching name is removed: with duplicate names, call again to remove the
 * next one, and list will still show the other until then.
 */
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
