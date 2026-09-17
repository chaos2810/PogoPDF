import {
  ComicToPdfInputSchema,
  EbookToPdfInputSchema,
  ExtractTablesInputSchema,
  OcrInputSchema,
  PdfToMarkdownInputSchema,
  PrepareForAiInputSchema,
  TOOL_IDS,
  XpsToPdfInputSchema,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runEbookToPdf } from "./ebooktopdf";
import { runComicToPdf } from "./comictopdf";
import { runXpsToPdf } from "./xpstopdf";
import { runOcr } from "./ocr";
import { runExtractTables } from "./extracttables";
import { runPdfToMarkdown } from "./pdftomarkdown";
import { runPrepareForAi } from "./prepareforai";

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
  tools.set(TOOL_IDS.extractTables, {
    schema: ExtractTablesInputSchema,
    run: runExtractTables,
  });
  tools.set(TOOL_IDS.pdfToMarkdown, {
    schema: PdfToMarkdownInputSchema,
    run: runPdfToMarkdown,
  });
  tools.set(TOOL_IDS.prepareForAi, {
    schema: PrepareForAiInputSchema,
    run: runPrepareForAi,
  });
}
