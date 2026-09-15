import {
  AlternateMixInputSchema,
  CombineSinglePageInputSchema,
  DuplexCollateInputSchema,
  SplitInputSchema,
  TOOL_IDS,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runSplit } from "./split";
import { runAlternateMix } from "./alternatemix";
import { runDuplexCollate } from "./duplexcollate";
import { runCombineSinglePage } from "./combinesingle";

export function registerBatchOrganizeTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.split, { schema: SplitInputSchema, run: runSplit });
  tools.set(TOOL_IDS.alternateMix, {
    schema: AlternateMixInputSchema,
    run: runAlternateMix,
  });
  tools.set(TOOL_IDS.duplexCollate, {
    schema: DuplexCollateInputSchema,
    run: runDuplexCollate,
  });
  tools.set(TOOL_IDS.combineSinglePage, {
    schema: CombineSinglePageInputSchema,
    run: runCombineSinglePage,
  });
}
