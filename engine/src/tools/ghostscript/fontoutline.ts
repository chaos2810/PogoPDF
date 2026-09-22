import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, PDFName } from "pdf-lib";
import { FontOutlineInputSchema, TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type { ProgressParams } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { gsError, runGs } from "./gsbin";

/** Full gswin64c argument list for the font-outline conversion (pure, for testing). */
export function buildFontOutlineArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-sDEVICE=pdfwrite",
    "-dNoOutputFonts",
    "-dNOPAUSE",
    "-dBATCH",
    `-sOutputFile=${outputPath}`,
    inputPath,
  ];
}

function assertInputExists(filePath: string): void {
  if (!existsSync(filePath)) {
    throw gsError(`File not found: ${filePath}`, TOOL_ERROR_CODES.CORRUPT_PDF);
  }
}

/** Ghostscript's own wording for an encrypted input (see pdftoa.ts for why anchored). */
const PASSWORD_PATTERN = /requires a password for access/i;

/**
 * Converts page text to vector outlines with Ghostscript's `-dNoOutputFonts`,
 * so the output needs no embedded fonts. This is a plain pdfwrite pass (no PDF/A
 * part): the tool's job is glyph outlining, not archival conformance.
 *
 * Verification level (honest): the output is parsed with pdf-lib to assert no
 * page keeps a /Font resource, and the caller renders it to assert the glyph ink
 * survives (outlined text is NOT extractable as text by construction). This is
 * an outline-and-renders check, not a glyph-by-glyph fidelity comparison.
 */
export async function runFontOutline(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath } = FontOutlineInputSchema.parse(input);
  assertNotCancelled(ctx);
  assertInputExists(filePath);

  ctx.notifyProgress({
    jobId: "",
    percent: 0,
    stage: "outlining",
    pagesDone: 0,
  } satisfies ProgressParams);

  const outPath = join(outDir, "outlined.pdf");
  const { stdout, stderr } = await runGs(
    buildFontOutlineArgs(filePath, outPath),
    outDir
  );

  // As with PDF/A, gs reports an encrypted input on the report streams yet
  // still exits 0 and leaves a blank file behind.
  const report = `${stdout}\n${stderr}`;
  if (PASSWORD_PATTERN.test(report)) {
    throw gsError(
      "This PDF is encrypted; remove the password before outlining the fonts",
      TOOL_ERROR_CODES.ENCRYPTED_PDF
    );
  }

  if (!existsSync(outPath)) {
    throw gsError(
      `Ghostscript produced no outlined output${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
      TOOL_ERROR_CODES.CORRUPT_PDF
    );
  }

  const doc = await PDFDocument.load(readFileSync(outPath), { updateMetadata: false });
  for (let i = 0; i < doc.getPageCount(); i++) {
    const fonts = doc.getPage(i).node.Resources()?.get(PDFName.of("Font"));
    if (fonts !== undefined) {
      throw gsError(
        `Ghostscript output still has a /Font resource on page ${i + 1}; outlining failed`,
        TOOL_ERROR_CODES.CORRUPT_PDF
      );
    }
  }

  ctx.notifyProgress({
    jobId: "",
    percent: 100,
    stage: "outlining",
    pagesDone: doc.getPageCount(),
  } satisfies ProgressParams);

  return outPath;
}
