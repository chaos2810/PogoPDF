import {
  AdjustColorsInputSchema,
  BackgroundColorInputSchema,
  ChangeTextColorInputSchema,
  DeskewInputSchema,
  InvertColorsInputSchema,
  PosterizeInputSchema,
  ScannerEffectInputSchema,
  TOOL_IDS,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runDeskew } from "./deskew";
import { runScannerEffect } from "./scanner";
import { runAdjustColors } from "./adjustcolors";
import { runInvertColors } from "./invertcolors";
import { runPosterize } from "./posterize";
import { runBackgroundColor } from "./bgcolor";
import { runChangeTextColor } from "./textcolor";

export function registerImageOpsTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.deskew, { schema: DeskewInputSchema, run: runDeskew });
  tools.set(TOOL_IDS.scannerEffect, { schema: ScannerEffectInputSchema, run: runScannerEffect });
  tools.set(TOOL_IDS.adjustColors, { schema: AdjustColorsInputSchema, run: runAdjustColors });
  tools.set(TOOL_IDS.invertColors, { schema: InvertColorsInputSchema, run: runInvertColors });
  tools.set(TOOL_IDS.posterize, { schema: PosterizeInputSchema, run: runPosterize });
  tools.set(TOOL_IDS.backgroundColor, {
    schema: BackgroundColorInputSchema,
    run: runBackgroundColor,
  });
  tools.set(TOOL_IDS.changeTextColor, {
    schema: ChangeTextColorInputSchema,
    run: runChangeTextColor,
  });
}
