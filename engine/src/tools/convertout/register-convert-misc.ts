import { PdfToCbzInputSchema, PdfToSvgInputSchema, TOOL_IDS } from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runPdfToSvg } from "./pdftosvg";
import { runPdfToCbz } from "./pdftocbz";

export function registerConvertMiscTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.pdfToSvg, {
    schema: PdfToSvgInputSchema,
    run: runPdfToSvg,
  });
  tools.set(TOOL_IDS.pdfToCbz, {
    schema: PdfToCbzInputSchema,
    run: runPdfToCbz,
  });
}
