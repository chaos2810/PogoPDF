import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { OfficeToPdfInputSchema, TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { runOfficeConvert } from "./libreoffice";

/** Input paths are user paths, so a missing file is worth naming cleanly. */
function assertInputExists(filePath: string): void {
  if (!existsSync(filePath)) {
    throw Object.assign(new Error(`File not found: ${filePath}`), {
      code: TOOL_ERROR_CODES.CORRUPT_PDF,
    });
  }
}

/**
 * Converts one office/ODF document to PDF with headless LibreOffice. The
 * conversion is atomic from the engine's point of view: soffice runs as a
 * separate process and cannot be interrupted mid-conversion in v1, so
 * cancellation is only checked before the spawn. The per-job profile dir keeps
 * concurrent conversions from sharing a LibreOffice profile lock.
 */
export async function runOfficeToPdf(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath } = OfficeToPdfInputSchema.parse(input);
  assertNotCancelled(ctx);
  assertInputExists(filePath);

  ctx.notifyProgress({ jobId: "", percent: 0, stage: "converting", pagesDone: 0 });
  const outPath = await runOfficeConvert(filePath, outDir, randomUUID());
  return outPath;
}
