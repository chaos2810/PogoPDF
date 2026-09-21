import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOOL_ERROR_CODES, RemoveRestrictionsInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { assertInputExists, qpdfError, runQpdf } from "../secure/qpdfbin";

/** Password file name inside the job's output dir (removed after the run). */
export const RESTRICTIONS_PASSWORD_FILE = "restrictions-password.txt";

/**
 * qpdf argument vector. An owner-restricted file has an empty user password, so
 * `--decrypt` alone removes the restrictions; a user password, when supplied,
 * travels in `--password-file` (its first line) so it never lands on argv.
 */
export function buildRemoveRestrictionsArgs(
  passwordFilePath: string | undefined,
  filePath: string,
  outPath: string
): string[] {
  const args: string[] = [];
  if (passwordFilePath !== undefined) args.push(`--password-file=${passwordFilePath}`);
  args.push("--decrypt", "--", filePath, outPath);
  return args;
}

/**
 * Removes encryption and owner restrictions with qpdf. Owner-restricted files
 * (empty user password) decrypt without any secret; a genuine user password is
 * optional and, when absent, the ENCRYPTED_PDF error carries a prompt to supply
 * one; a supplied-but-wrong password reports that it was incorrect.
 */
export async function runRemoveRestrictions(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, password } = RemoveRestrictionsInputSchema.parse(input);
  assertNotCancelled(ctx);
  assertInputExists(filePath);

  const outPath = join(outDir, "unrestricted.pdf");
  let pwPath: string | undefined;
  if (password !== undefined) {
    pwPath = join(outDir, RESTRICTIONS_PASSWORD_FILE);
    writeFileSync(pwPath, password);
  }

  try {
    await runQpdf(buildRemoveRestrictionsArgs(pwPath, filePath, outPath), outDir);
  } catch (e) {
    if ((e as { code?: number }).code === TOOL_ERROR_CODES.ENCRYPTED_PDF) {
      if (password !== undefined) {
        throw qpdfError(
          "Incorrect password. This PDF could not be unlocked.",
          TOOL_ERROR_CODES.ENCRYPTED_PDF
        );
      }
      // No password supplied: qpdf's raw "supplied password was rejected" is
      // misleading here, since the user was never asked for one.
      throw qpdfError(
        "This file needs a password to open. Supply the password and retry.",
        TOOL_ERROR_CODES.ENCRYPTED_PDF
      );
    }
    throw e;
  } finally {
    if (pwPath !== undefined) {
      try {
        unlinkSync(pwPath);
      } catch {
        /* already gone or locked; the job dir is cleaned on engine exit */
      }
    }
  }

  return outPath;
}
