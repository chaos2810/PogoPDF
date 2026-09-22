import {
  ComparePdfsInputSchema,
  OverlayInputSchema,
  PdfsToZipInputSchema,
  RasterizeInputSchema,
  TOOL_IDS,
  WorkflowInputSchema,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runComparePdfs } from "./comparepdfs";
import { runOverlay } from "./overlay";
import { runPdfsToZip } from "./pdfstozip";
import { runRasterize } from "./rasterize";
import { runWorkflow } from "./workflow";

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
  tools.set(TOOL_IDS.overlay, {
    schema: OverlayInputSchema,
    run: runOverlay,
  });
  tools.set(TOOL_IDS.workflow, {
    schema: WorkflowInputSchema,
    // The workflow resolves and invokes other registry entries, so it closes
    // over the same map it is registered in (complete by run time).
    run: (input, ctx, outDir) => runWorkflow(input, ctx, outDir, tools),
  });
}
