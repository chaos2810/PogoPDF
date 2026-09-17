import {
  ComicToPdfInputSchema,
  EbookToPdfInputSchema,
  OcrInputSchema,
  TOOL_IDS,
  XpsToPdfInputSchema,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runEbookToPdf } from "./ebooktopdf";
import { runComicToPdf } from "./comictopdf";
import { runXpsToPdf } from "./xpstopdf";
import { runOcr } from "./ocr";

export function registerRichContentTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.ebookToPdf, {
    schema: EbookToPdfInputSchema,
    run: runEbookToPdf,
  });
  tools.set(TOOL_IDS.xpsToPdf, {
    schema: XpsToPdfInputSchema,
    run: runXpsToPdf,
  });
  tools.set(TOOL_IDS.comicToPdf, {
    schema: ComicToPdfInputSchema,
    run: runComicToPdf,
  });
  tools.set(TOOL_IDS.ocr, {
    schema: OcrInputSchema,
    run: runOcr,
  });
}
