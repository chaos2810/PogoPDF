import {
  HeaderFooterInputSchema,
  PageNumbersInputSchema,
  TOOL_IDS,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runPageNumbers } from "./pagenumbers";
import { runHeaderFooter } from "./headerfooter";

export function registerEditTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.pageNumbers, {
    schema: PageNumbersInputSchema,
    run: runPageNumbers,
  });
  tools.set(TOOL_IDS.headerFooter, {
    schema: HeaderFooterInputSchema,
    run: runHeaderFooter,
  });
}
