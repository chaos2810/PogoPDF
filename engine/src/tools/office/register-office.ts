import { OfficeToPdfInputSchema, TOOL_IDS } from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runOfficeToPdf } from "./officetopdf";

export function registerOfficeTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.officeToPdf, {
    schema: OfficeToPdfInputSchema,
    run: runOfficeToPdf,
  });
}
