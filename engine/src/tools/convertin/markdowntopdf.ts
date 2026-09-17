import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { MarkdownToPdfInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { buildPdf, readTextFile } from "../../textpdf/docbuilder";
import { renderMarkdownBlocks, sanitizeMarkdown } from "../../textpdf/render-blocks";

export async function runMarkdownToPdf(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, fontSize, margins } = MarkdownToPdfInputSchema.parse(input);
  assertNotCancelled(ctx);

  const markdown = await readTextFile(filePath);
  const body = sanitizeMarkdown(markdown).body;

  const bytes = await buildPdf({ fontSize, margins }, (doc) => {
    renderMarkdownBlocks(doc, body, fontSize);
  });

  const outPath = join(outDir, `${basename(filePath, extname(filePath))}.pdf`);
  await writeFile(outPath, bytes);
  return outPath;
}
