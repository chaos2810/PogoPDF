import PDFDocument from "pdfkit";
import { PassThrough } from "node:stream";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";

export type BuildPdfOptions = {
  fontSize: number;
  margins: number;
};

/**
 * Render a PDFKit document to a Buffer. `write` drives the document (text,
 * rects, page breaks); the wrapper owns stream plumbing only.
 */
export function buildPdf(
  opts: BuildPdfOptions,
  write: (doc: PDFKit.PDFDocument) => void
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: {
      top: opts.margins,
      bottom: opts.margins,
      left: opts.margins,
      right: opts.margins,
    },
    font: "Helvetica",
  });
  // `fontSize` is a legal runtime constructor option but absent from
  // @types/pdfkit's PDFDocumentOptions, so set it on the instance instead.
  doc.font("Helvetica").fontSize(opts.fontSize);

  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pass.on("data", (chunk: Buffer) => chunks.push(chunk));
    pass.on("end", () => resolve(Buffer.concat(chunks)));
    pass.on("error", reject);
  });

  doc.pipe(pass);
  write(doc);
  doc.end();
  return done;
}

/**
 * Read a plain-text source as UTF-8: strips a leading BOM, normalises CRLF/CR
 * to LF and expands tabs to four spaces. Invalid byte sequences are replaced
 * (Node's utf8 decoder), never thrown. Missing files and unreadable paths
 * (e.g. a directory, EISDIR) are CORRUPT_PDF.
 */
export async function readTextFile(path: string): Promise<string> {
  if (!existsSync(path)) {
    throw Object.assign(new Error(`File not found: ${path}`), {
      code: TOOL_ERROR_CODES.CORRUPT_PDF,
    });
  }
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    const reason = (e as NodeJS.ErrnoException).code ?? "unreadable";
    throw Object.assign(new Error(`Cannot read text file: ${path} (${reason})`), {
      code: TOOL_ERROR_CODES.CORRUPT_PDF,
    });
  }
  return raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
}
