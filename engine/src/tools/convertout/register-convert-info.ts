import {
  FixPageSizeInputSchema,
  PageDimensionsInputSchema,
  TOOL_IDS,
  ViewMetadataInputSchema,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runViewMetadata } from "./viewmetadata";
import { runPageDimensions } from "./pagedimensions";
import { runFixPageSize } from "./fixpagesize";

export function registerConvertInfoTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.viewMetadata, {
    schema: ViewMetadataInputSchema,
    run: runViewMetadata,
  });
  tools.set(TOOL_IDS.pageDimensions, {
    schema: PageDimensionsInputSchema,
    run: runPageDimensions,
  });
  tools.set(TOOL_IDS.fixPageSize, {
    schema: FixPageSizeInputSchema,
    run: runFixPageSize,
  });
}
