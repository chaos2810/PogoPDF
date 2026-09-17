import { ImagesToPdfInputSchema, TOOL_IDS } from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runImagesToPdf } from "./imagestopdf";

export function registerConvertInTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.imagesToPdf, {
    schema: ImagesToPdfInputSchema,
    run: runImagesToPdf,
  });
}
