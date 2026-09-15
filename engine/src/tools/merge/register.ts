import { MergeInputSchema, TOOL_IDS } from "@pogopdf/contracts";
import { runMerge } from "./merge";
import type { ToolRegistry } from "../registry";

export function registerMergeTool(tools: ToolRegistry) {
  tools.set(TOOL_IDS.merge, { schema: MergeInputSchema, run: runMerge });
}
