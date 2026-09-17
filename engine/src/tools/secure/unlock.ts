import { TOOL_ERROR_CODES, UnlockInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { assertInputExists, qpdfError, runQpdf } from "./qpdfbin";
import { join } from "node:path";

/**
 * Removes encryption with the supplied password. qpdf's `--decrypt` also passes
 * an unencrypted input through unchanged, so the "already open" case needs no
 * special handling — it is simply a copy into the job dir.
 */
export async function runUnlock(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, password } = UnlockInputSchema.parse(input);
  assertNotCancelled(ctx);
  assertInputExists(filePath);

  const outPath = join(outDir, "unlocked.pdf");
  try {
    await runQpdf(
      [`--password=${password}`, "--decrypt", "--", filePath, outPath],
      outDir
    );
  } catch (e) {
    // qpdf words its password rejection differently per subcommand ("invalid
    // password", "Incorrect password supplied"); runQpdf already maps those to
    // ENCRYPTED_PDF, so only normalize the message into a clean user-facing one.
    if ((e as { code?: number }).code === TOOL_ERROR_CODES.ENCRYPTED_PDF) {
      throw qpdfError(
        "Incorrect password — this PDF could not be unlocked",
        TOOL_ERROR_CODES.ENCRYPTED_PDF
      );
    }
    throw e;
  }

  return outPath;
}
