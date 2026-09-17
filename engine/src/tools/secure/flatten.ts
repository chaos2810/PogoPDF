import { FlattenInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { assertInputExists, runQpdf } from "./qpdfbin";
import { join } from "node:path";

/**
 * Pushes annotations into the page content with qpdf's `--flatten-annotations`.
 * qpdf 11 has no bare `--flatten`; `=all` is the variant that also merges form
 * field widgets into the content stream and drops the AcroForm.
 */
export async function runFlatten(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath } = FlattenInputSchema.parse(input);
  assertNotCancelled(ctx);
  assertInputExists(filePath);

  const outPath = join(outDir, "flattened.pdf");
  await runQpdf(
    ["--flatten-annotations=all", "--", filePath, outPath],
    outDir
  );

  return outPath;
}
