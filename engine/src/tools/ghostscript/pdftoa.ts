import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, PDFName } from "pdf-lib";
import { PdfToPdfAInputSchema, TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type { ProgressParams } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { gsError, runGs, GS_PASSWORD_PATTERN } from "./gsbin";

/** "1b"/"2b"/"3b" -> the -dPDFA= number. */
const PDFA_PART: Record<string, string> = { "1b": "1", "2b": "2", "3b": "3" };

/**
 * Minimal PDF/A definition prefix. Ghostscript's plain `-dPDFA=2` run does NOT
 * add the catalog /OutputIntents entry the standard requires; the shipped
 * `PDFA_def.ps` sample does, but it also overwrites the document title. This
 * carries only the OutputIntent: the sRGB ICC profile is read from Ghostscript's
 * own ROM filesystem (`%rom%iccprofiles/srgb.icc`), which needs no absolute path
 * and no `--permit-file-read` (unlike the sample's relative `srgb.icc`).
 */
const PDFA_DEF_PS = `%!
/ICCProfile (%rom%iccprofiles/srgb.icc) def
[ /_objdef {icc_PDFA} /type /stream /OBJ pdfmark
[{icc_PDFA} <</N 3>> /PUT pdfmark
[
{icc_PDFA}
{ICCProfile (r) file} stopped {
  (PogoPDF: could not open the sRGB ICC profile for the PDF/A output intent\\n) print
  cleartomark
} {
  /PUT pdfmark
  [/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark
  [{OutputIntent_PDFA} <<
    /Type /OutputIntent
    /S /GTS_PDFA1
    /DestOutputProfile {icc_PDFA}
    /OutputConditionIdentifier (sRGB)
  >> /PUT pdfmark
  [{Catalog} <</OutputIntents [ {OutputIntent_PDFA} ]>> /PUT pdfmark
} ifelse
`;

/** Full gswin64c argument list for a PDF/A conversion (pure, for testing). */
export function buildPdfAArgs(
  version: string,
  defPath: string,
  inputPath: string,
  outputPath: string
): string[] {
  return [
    `-dPDFA=${PDFA_PART[version]}`,
    "-dPDFACompatibilityPolicy=1",
    "-sColorConversionStrategy=RGB",
    "-sDEVICE=pdfwrite",
    "-dNOPAUSE",
    "-dBATCH",
    `-sOutputFile=${outputPath}`,
    defPath,
    inputPath,
  ];
}

function assertInputExists(filePath: string): void {
  if (!existsSync(filePath)) {
    throw gsError(`File not found: ${filePath}`, TOOL_ERROR_CODES.CORRUPT_PDF);
  }
}

/**
 * Converts a PDF to PDF/A with Ghostscript. `pdfaVersion` selects the part
 * (1b/2b/3b). The OutputIntent prefix file supplies the catalog /OutputIntents
 * the standard requires; its absence (an ICC read failure) aborts the run.
 *
 * Verification level (honest): the output is parsed with pdf-lib to assert the
 * catalog /OutputIntents entry exists, and pdf.js loads and renders it (the
 * caller's render proof in tests). This is NOT a veraPDF-grade conformance
 * check; PogoPDF does not ship a PDF/A validator, so "PDF/A" here means
 * Ghostscript's converter ran with the part/level flags and produced the
 * required OutputIntent structure.
 */
export async function runPdfToPdfA(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, pdfaVersion } = PdfToPdfAInputSchema.parse(input);
  assertNotCancelled(ctx);
  assertInputExists(filePath);

  ctx.notifyProgress({
    jobId: "",
    percent: 0,
    stage: "converting",
    pagesDone: 0,
  } satisfies ProgressParams);

  const defPath = join(outDir, "pdfa-def.ps");
  writeFileSync(defPath, PDFA_DEF_PS);
  const outPath = join(outDir, "pdfa.pdf");

  let stdout: string;
  let stderr: string;
  try {
    ({ stdout, stderr } = await runGs(
      buildPdfAArgs(pdfaVersion, defPath, filePath, outPath),
      outDir
    ));
  } finally {
    // The prefix file is a build input, not a job output; the UI lists the job
    // dir contents as Save As candidates.
    rmSync(defPath, { force: true });
  }

  // gs reports an encrypted input on the report streams yet still exits 0 and
  // leaves a blank file behind, so the exit code alone cannot tell success from
  // this failure (verified against gs 10.08.0).
  const report = `${stdout}\n${stderr}`;
  if (GS_PASSWORD_PATTERN.test(report)) {
    throw gsError(
      "This PDF is encrypted; remove the password before converting to PDF/A",
      TOOL_ERROR_CODES.ENCRYPTED_PDF
    );
  }

  if (!existsSync(outPath)) {
    throw gsError(
      `Ghostscript produced no PDF/A output${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
      TOOL_ERROR_CODES.CORRUPT_PDF
    );
  }

  // An honest structural check: a PDF/A conversion that lost the OutputIntent
  // (for example an ICC read failure) is not a PDF/A file, so refuse it rather
  // than hand the user a mislabelled document.
  const doc = await PDFDocument.load(readFileSync(outPath), { updateMetadata: false });
  if (doc.catalog.get(PDFName.of("OutputIntents")) === undefined) {
    throw gsError(
      "Ghostscript output has no /OutputIntents entry; the PDF/A definition failed",
      TOOL_ERROR_CODES.CORRUPT_PDF
    );
  }

  ctx.notifyProgress({
    jobId: "",
    percent: 100,
    stage: "converting",
    pagesDone: doc.getPageCount(),
  } satisfies ProgressParams);

  return outPath;
}
