import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ProtectInputSchema } from "@pogopdf/contracts";
import type { ProtectInput } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { assertInputExists, runQpdf } from "./qpdfbin";

/** Job-JSON file name inside the job's output dir (removed after the run). */
export const PROTECT_JOB_FILE = "protect-job.json";

/**
 * qpdf's job-JSON representation of an AES-256 encrypt job. Passwords are values
 * in this file (referenced by path on the command line) rather than argv, so
 * they never appear in the process command line. `--encrypt` in argv form takes
 * the passwords positionally and has no file-based equivalent, so job JSON is
 * the supported path for keeping them off argv.
 */
export function buildEncryptJob(input: ProtectInput, outPath: string): object {
  const { filePath, userPassword, ownerPassword, allowPrinting, allowCopying } = input;
  return {
    inputFile: filePath,
    outputFile: outPath,
    encrypt: {
      // qpdf requires both keys in job JSON; empty user password means "no
      // password to open", matching the CLI's empty-string semantics.
      userPassword: userPassword ?? "",
      ownerPassword,
      "256bit": {
        print: allowPrinting ? "full" : "none",
        extract: allowCopying ? "y" : "n",
        modify: "none",
      },
    },
  };
}

/** Argument vector handed to qpdf: a single path reference, no secret material. */
export function buildEncryptArgs(jobFilePath: string): string[] {
  return [`--job-json-file=${jobFilePath}`];
}

/**
 * AES-256 encryption via qpdf. The user password may be empty (the file then
 * opens without a password but keeps its restrictions); the owner password is
 * required. Passwords are written to a job-JSON file in the (non-user-visible,
 * per-job) output dir and the file is deleted in a finally block.
 */
export async function runProtect(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const parsed = ProtectInputSchema.parse(input);
  assertNotCancelled(ctx);
  assertInputExists(parsed.filePath);

  const outPath = join(outDir, "protected.pdf");
  const jobPath = join(outDir, PROTECT_JOB_FILE);
  writeFileSync(jobPath, JSON.stringify(buildEncryptJob(parsed, outPath)));
  try {
    await runQpdf(buildEncryptArgs(jobPath), outDir);
  } finally {
    // Best-effort: the password must not linger on disk once qpdf has read it.
    try {
      unlinkSync(jobPath);
    } catch {
      /* already gone or locked; the job dir is cleaned on engine exit */
    }
  }

  return outPath;
}
