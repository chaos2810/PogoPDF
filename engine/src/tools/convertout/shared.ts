import { existsSync } from "node:fs";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { getPdfRenderer, type PdfRenderer } from "../../render/renderpdf";

/**
 * `getPdfRenderer` throws raw pdf.js errors (PasswordException, InvalidPDF,
 * ENOENT). Raster tools need typed codes, so map them the same way `loadPdf`
 * does, once here instead of in each handler.
 */
export async function openRenderer(path: string): Promise<PdfRenderer> {
  if (!existsSync(path)) {
    throw Object.assign(new Error(`File not found: ${path}`), {
      code: TOOL_ERROR_CODES.CORRUPT_PDF,
    });
  }
  try {
    return await getPdfRenderer(path);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = /encrypt|password/i.test(msg)
      ? TOOL_ERROR_CODES.ENCRYPTED_PDF
      : TOOL_ERROR_CODES.CORRUPT_PDF;
    throw Object.assign(new Error(`Cannot open ${path}: ${msg}`), { code });
  }
}
