import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { PdfsToZipInputSchema, TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";

/** Insert a numeric suffix before the extension: "a.pdf" + 2 -> "a-2.pdf". */
function withSuffix(name: string, n: number): string {
  const ext = extname(name);
  const stem = basename(name, ext);
  return `${stem}-${n}${ext}`;
}

/**
 * Packages every input PDF into one "archive.zip". Entry names are the input
 * basenames; duplicates (same name in different directories) get a "-2", "-3"
 * suffix so no entry is silently dropped. The output name is fixed rather than
 * derived from the first file, matching the UI which already offers a Save As.
 */
export async function runPdfsToZip(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePaths } = PdfsToZipInputSchema.parse(input);
  assertNotCancelled(ctx);

  const zip = new JSZip();
  const used = new Set<string>();

  for (let i = 0; i < filePaths.length; i++) {
    const path = filePaths[i];
    assertNotCancelled(ctx);
    if (!existsSync(path)) {
      throw Object.assign(new Error(`File not found: ${path}`), {
        code: TOOL_ERROR_CODES.CORRUPT_PDF,
      });
    }

    const name = basename(path);
    // Probe against every entry already written, not just the basename, so a
    // crafted suffix (a real "x-2.pdf") cannot be silently overwritten by the
    // suffix generated for a later "x.pdf".
    let entry = name;
    for (let n = 2; used.has(entry); n++) {
      entry = withSuffix(name, n);
    }
    used.add(entry);

    zip.file(entry, await readFile(path));

    const done = i + 1;
    ctx.notifyProgress({
      jobId: "",
      percent: Math.round((done / filePaths.length) * 100),
      stage: "zipping",
      pagesDone: done,
    });
  }

  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const outPath = join(outDir, "archive.zip");
  await writeFile(outPath, buf);
  return outPath;
}
