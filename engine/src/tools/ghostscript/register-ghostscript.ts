import { FontOutlineInputSchema, PdfToPdfAInputSchema, TOOL_IDS } from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runPdfToPdfA } from "./pdftoa";
import { runFontOutline } from "./fontoutline";

export function registerGhostscriptTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.pdfToPdfA, {
    schema: PdfToPdfAInputSchema,
    run: runPdfToPdfA,
  });
  tools.set(TOOL_IDS.fontOutline, {
    schema: FontOutlineInputSchema,
    run: runFontOutline,
  });
}
