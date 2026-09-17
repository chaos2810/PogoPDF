import {
  CsvToPdfInputSchema,
  ImagesToPdfInputSchema,
  MarkdownToPdfInputSchema,
  TextToPdfInputSchema,
  TOOL_IDS,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runImagesToPdf } from "./imagestopdf";
import { runTextToPdf } from "./texttopdf";
import { runMarkdownToPdf } from "./markdowntopdf";
import { runCsvToPdf } from "./csvtopdf";

export function registerConvertInTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.imagesToPdf, {
    schema: ImagesToPdfInputSchema,
    run: runImagesToPdf,
  });
  tools.set(TOOL_IDS.textToPdf, {
    schema: TextToPdfInputSchema,
    run: runTextToPdf,
  });
  tools.set(TOOL_IDS.markdownToPdf, {
    schema: MarkdownToPdfInputSchema,
    run: runMarkdownToPdf,
  });
  tools.set(TOOL_IDS.csvToPdf, {
    schema: CsvToPdfInputSchema,
    run: runCsvToPdf,
  });
}
