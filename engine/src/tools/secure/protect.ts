import { ProtectInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { assertInputExists, runQpdf } from "./qpdfbin";
import { join } from "node:path";

/**
 * AES-256 encryption via qpdf. The user password may be empty (the file then
 * opens without a password but keeps its restrictions); the owner password is
 * required. `--print`/`--extract` take full/none and y/n respectively.
 */
export async function runProtect(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, userPassword, ownerPassword, allowPrinting, allowCopying } =
    ProtectInputSchema.parse(input);
  assertNotCancelled(ctx);
  assertInputExists(filePath);

  const outPath = join(outDir, "protected.pdf");
  await runQpdf(
    [
      "--encrypt",
      userPassword ?? "",
      ownerPassword,
      "256",
      `--print=${allowPrinting ? "full" : "none"}`,
      `--extract=${allowCopying ? "y" : "n"}`,
      "--modify=none",
      "--",
      filePath,
      outPath,
    ],
    outDir
  );

  return outPath;
}
