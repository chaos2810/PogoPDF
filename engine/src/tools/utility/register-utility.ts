import {
  ComparePdfsInputSchema,
  PdfsToZipInputSchema,
  RasterizeInputSchema,
  TOOL_IDS,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runComparePdfs } from "./comparepdfs";
import { runPdfsToZip } from "./pdfstozip";
import { runRasterize } from "./rasterize";

export function registerUtilityTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.comparePdfs, {
    schema: ComparePdfsInputSchema,
    run: runComparePdfs,
  });
  tools.set(TOOL_IDS.pdfsToZip, {
    schema: PdfsToZipInputSchema,
    run: runPdfsToZip,
  });
  tools.set(TOOL_IDS.rasterize, {
    schema: RasterizeInputSchema,
    run: runRasterize,
  });
}
