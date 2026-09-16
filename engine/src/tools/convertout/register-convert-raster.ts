import {
  ExtractImagesInputSchema,
  PdfToGreyscaleInputSchema,
  PdfToImagesInputSchema,
  PdfToTextInputSchema,
  TOOL_IDS,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runPdfToImages } from "./pdftoimages";
import { runPdfToText } from "./pdftotext";
import { runPdfToGreyscale } from "./pdftogreyscale";
import { runExtractImages } from "./extractimages";

export function registerConvertRasterTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.pdfToImages, {
    schema: PdfToImagesInputSchema,
    run: runPdfToImages,
  });
  tools.set(TOOL_IDS.pdfToText, {
    schema: PdfToTextInputSchema,
    run: runPdfToText,
  });
  tools.set(TOOL_IDS.pdfToGreyscale, {
    schema: PdfToGreyscaleInputSchema,
    run: runPdfToGreyscale,
  });
  tools.set(TOOL_IDS.extractImages, {
    schema: ExtractImagesInputSchema,
    run: runExtractImages,
  });
}
