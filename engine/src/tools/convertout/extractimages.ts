import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFDocument,
} from "pdf-lib";
import { ExtractImagesInputSchema, TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf } from "../pdfdoc";

type Extracted = { bytes: Uint8Array; ext: "jpg" | "jp2" };

const DCT = PDFName.of("DCTDecode");
const JPX = PDFName.of("JPXDecode");
// pdf-lib exports no PDFName.Subtype / PDFName.Filter statics.
const SUBTYPE = PDFName.of("Subtype");
const IMAGE = PDFName.of("Image");
const FILTER = PDFName.of("Filter");

/** The /Filter entry may be one name or an array; DCT/JPX anywhere wins. */
function filterNames(value: unknown): PDFName[] {
  if (value instanceof PDFName) return [value];
  if (value instanceof PDFArray) {
    const names: PDFName[] = [];
    for (let i = 0; i < value.size(); i++) {
      const entry = value.get(i);
      if (entry instanceof PDFName) names.push(entry);
    }
    return names;
  }
  return [];
}

function collectFromPage(doc: PDFDocument, pageIndex: number, out: Extracted[]): void {
  const context = doc.context;
  const resources = doc.getPage(pageIndex).node.Resources();
  const xObjects = resources?.lookupMaybe(PDFName.XObject, PDFDict);
  if (!xObjects) return;

  for (const key of xObjects.keys()) {
    // lookupMaybe's overloads accept PDFStream but not its raw subclass.
    const maybe = xObjects.lookupMaybe(key, PDFStream);
    if (!(maybe instanceof PDFRawStream)) continue;
    const stream = maybe;
    if (stream.dict.get(SUBTYPE)?.toString() !== IMAGE.toString()) continue;

    const filter = stream.dict.get(FILTER);
    const names = filterNames(
      filter instanceof PDFRef ? context.lookup(filter) : filter
    ).map((f) => f.toString());
    const bytes = stream.contents;
    if (names.includes(DCT.toString())) {
      out.push({ bytes, ext: "jpg" });
    } else if (names.includes(JPX.toString())) {
      out.push({ bytes, ext: "jp2" });
    }
    // FlateDecode/LZW/etc. carry no self-describing container, so v1 skips them.
  }
}

export async function runExtractImages(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string[]> {
  const { filePath } = ExtractImagesInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath);
  const found: Extracted[] = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    collectFromPage(doc, i, found);
  }

  if (found.length === 0) {
    throw Object.assign(new Error("No embedded JPEG/JP2 images found in this file"), {
      code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT,
    });
  }

  const out: string[] = [];
  for (let n = 0; n < found.length; n++) {
    const { bytes, ext } = found[n];
    const outPath = join(outDir, `image-${n + 1}.${ext}`);
    await writeFile(outPath, bytes);
    out.push(outPath);
    const done = n + 1;
    ctx.notifyProgress({
      jobId: "",
      percent: Math.round((done / found.length) * 100),
      stage: "extracting",
      pagesDone: done,
    });
  }
  return out;
}
