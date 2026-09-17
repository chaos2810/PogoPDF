import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { TextToPdfInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { buildPdf, readTextFile } from "../../textpdf/docbuilder";

export async function runTextToPdf(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, fontSize, margins } = TextToPdfInputSchema.parse(input);
  assertNotCancelled(ctx);

  const text = await readTextFile(filePath);
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const bytes = await buildPdf({ fontSize, margins }, (doc) => {
    doc.font("Helvetica").fontSize(fontSize);
    paragraphs.forEach((paragraph, i) => {
      if (i > 0) doc.moveDown();
      doc.text(paragraph);
    });
  });

  const outPath = join(outDir, `${basename(filePath, extname(filePath))}.pdf`);
  await writeFile(outPath, bytes);
  return outPath;
}
