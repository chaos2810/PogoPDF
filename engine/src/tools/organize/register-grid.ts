import {
  BookletInputSchema,
  DividePagesInputSchema,
  NupInputSchema,
  OrganizeInputSchema,
  TOOL_IDS,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runNup } from "./nup";
import { runBooklet } from "./booklet";
import { runDivide } from "./divide";
import { runOrganizeGrid } from "./organizegrid";

export function registerGridOrganizeTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.nup, { schema: NupInputSchema, run: runNup });
  tools.set(TOOL_IDS.booklet, { schema: BookletInputSchema, run: runBooklet });
  tools.set(TOOL_IDS.dividePages, {
    schema: DividePagesInputSchema,
    run: runDivide,
  });
  tools.set(TOOL_IDS.organize, {
    schema: OrganizeInputSchema,
    run: runOrganizeGrid,
  });
}
