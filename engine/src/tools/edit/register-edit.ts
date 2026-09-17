import {
  CropInputSchema,
  EditMetadataInputSchema,
  HeaderFooterInputSchema,
  PageNumbersInputSchema,
  RemoveMetadataInputSchema,
  TOOL_IDS,
  WatermarkInputSchema,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runPageNumbers } from "./pagenumbers";
import { runHeaderFooter } from "./headerfooter";
import { runWatermark } from "./watermark";
import { runCrop } from "./crop";
import { runEditMetadata } from "./editmetadata";
import { runRemoveMetadata } from "./removemetadata";

export function registerEditTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.pageNumbers, {
    schema: PageNumbersInputSchema,
    run: runPageNumbers,
  });
  tools.set(TOOL_IDS.headerFooter, {
    schema: HeaderFooterInputSchema,
    run: runHeaderFooter,
  });
  tools.set(TOOL_IDS.watermark, {
    schema: WatermarkInputSchema,
    run: runWatermark,
  });
  tools.set(TOOL_IDS.crop, {
    schema: CropInputSchema,
    run: runCrop,
  });
  tools.set(TOOL_IDS.editMetadata, {
    schema: EditMetadataInputSchema,
    run: runEditMetadata,
  });
  tools.set(TOOL_IDS.removeMetadata, {
    schema: RemoveMetadataInputSchema,
    run: runRemoveMetadata,
  });
}
