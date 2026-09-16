import { PDFDocument } from "pdf-lib";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";

export async function loadPdf(
  path: string,
  opts: { updateMetadata?: boolean } = {}
): Promise<PDFDocument> {
  if (!existsSync(path)) {
    throw Object.assign(new Error(`File not found: ${path}`), {
      code: TOOL_ERROR_CODES.CORRUPT_PDF,
    });
  }
  try {
    return await PDFDocument.load(await readFile(path), {
      ignoreEncryption: false,
      // pdf-lib's load-time default rewrites /Producer and /ModDate in memory.
      // Pass false to read the file's real values (viewMetadata only reads).
      updateMetadata: opts.updateMetadata ?? true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = /encrypt/i.test(msg)
      ? TOOL_ERROR_CODES.ENCRYPTED_PDF
      : TOOL_ERROR_CODES.CORRUPT_PDF;
    throw Object.assign(new Error(`Cannot load ${path}: ${msg}`), { code });
  }
}

export async function savePdf(
  doc: PDFDocument,
  outDir: string,
  name = "output.pdf"
): Promise<string> {
  const outPath = join(outDir, name);
  await writeFile(outPath, await doc.save());
  return outPath;
}
