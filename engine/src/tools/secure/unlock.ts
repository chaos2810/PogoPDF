import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOOL_ERROR_CODES, UnlockInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { assertInputExists, qpdfError, runQpdf } from "./qpdfbin";

/** Password file name inside the job's output dir (removed after the run). */
export const UNLOCK_PASSWORD_FILE = "unlock-password.txt";

/** Argument vector handed to qpdf: `--password-file` keeps the secret off argv. */
export function buildDecryptArgs(passwordFilePath: string, filePath: string, outPath: string): string[] {
  return [`--password-file=${passwordFilePath}`, "--decrypt", "--", filePath, outPath];
}

/**
 * Removes encryption with the supplied password. The password is written to a
 * file in the per-job output dir and referenced with qpdf's `--password-file`
 * (its first line is the password), so it never appears in the process command
 * line. Only the first line is read, so the file is written without a trailing
 * newline anyway. qpdf's `--decrypt` also passes an unencrypted input through
 * unchanged, so the "already open" case needs no special handling.
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
  const pwPath = join(outDir, UNLOCK_PASSWORD_FILE);
  writeFileSync(pwPath, password);
  try {
    await runQpdf(buildDecryptArgs(pwPath, filePath, outPath), outDir);
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
  } finally {
    try {
      unlinkSync(pwPath);
    } catch {
      /* already gone or locked; the job dir is cleaned on engine exit */
    }
  }

  return outPath;
}
