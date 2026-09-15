import {
  AddBlankPageInputSchema,
  DeletePagesInputSchema,
  ExtractPagesInputSchema,
  ReverseInputSchema,
  RotateCustomInputSchema,
  RotateInputSchema,
  TOOL_IDS,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runExtract } from "./extract";
import { runDelete } from "./delete";
import { runReverse } from "./reverse";
import { runRotate, runRotateCustom } from "./rotate";
import { runAddBlankPage } from "./addblank";

export function registerSimpleOrganizeTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.extractPages, {
    schema: ExtractPagesInputSchema,
    run: runExtract,
  });
  tools.set(TOOL_IDS.deletePages, {
    schema: DeletePagesInputSchema,
    run: runDelete,
  });
  tools.set(TOOL_IDS.reverse, { schema: ReverseInputSchema, run: runReverse });
  tools.set(TOOL_IDS.rotate, { schema: RotateInputSchema, run: runRotate });
  tools.set(TOOL_IDS.rotateCustom, {
    schema: RotateCustomInputSchema,
    run: runRotateCustom,
  });
  tools.set(TOOL_IDS.addBlankPage, {
    schema: AddBlankPageInputSchema,
    run: runAddBlankPage,
  });
}
