import { basename, extname, join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  AddAttachmentsInputSchema,
  EditAttachmentsInputSchema,
  ExtractAttachmentsInputSchema,
  TOOL_ERROR_CODES,
} from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import {
  getEmbeddedFile,
  listEmbeddedFileEntries,
  removeEmbeddedFile,
} from "./embeddedfiles";

function missingFile(path: string): Error {
  return Object.assign(new Error(`File not found: ${path}`), {
    code: TOOL_ERROR_CODES.CORRUPT_PDF,
  });
}

/** Last path segment, stripped of both separator styles on any platform. */
function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.trim() ?? "";
  return base.length > 0 && base !== "." && base !== ".." ? base : "attachment";
}

/** Insert a numeric suffix before the extension: "a.txt" + 2 -> "a-2.txt". */
function withSuffix(name: string, n: number): string {
  const ext = extname(name);
  const stem = basename(name, ext);
  return `${stem}-${n}${ext}`;
}

export async function runAddAttachments(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, attachments } = AddAttachmentsInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath);
  for (let i = 0; i < attachments.length; i++) {
    assertNotCancelled(ctx);
    const path = attachments[i];
    if (!existsSync(path)) throw missingFile(path);
    await doc.attach(await readFile(path), basename(path));
    const done = i + 1;
    ctx.notifyProgress({
      jobId: "",
      percent: Math.round((done / attachments.length) * 100),
      stage: "attaching",
      pagesDone: done,
    });
  }

  return savePdf(doc, outDir, "attachments.pdf");
}

/**
 * Extracts every entry in the EmbeddedFiles name tree, flat /Names or nested
 * /Kids. Names are sanitized to their last path segment and duplicates get a
 * "-2", "-3" suffix so no entry is silently dropped and a crafted embedded name
 * cannot escape outDir.
 */
export async function runExtractAttachments(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string[]> {
  const { filePath } = ExtractAttachmentsInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath, { updateMetadata: false });
  const files = listEmbeddedFileEntries(doc);
  if (files.length === 0) {
    throw Object.assign(new Error("No embedded files in this PDF"), {
      code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT,
    });
  }

  const used = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < files.length; i++) {
    assertNotCancelled(ctx);
    const bytes = getEmbeddedFile(doc, files[i]);
    if (bytes !== undefined) {
      const safe = sanitizeName(files[i].name);
      let entry = safe;
      for (let n = 2; used.has(entry); n++) entry = withSuffix(safe, n);
      used.add(entry);

      const outPath = join(outDir, entry);
      await writeFile(outPath, bytes);
      out.push(outPath);
    }
    const done = i + 1;
    ctx.notifyProgress({
      jobId: "",
      percent: Math.round((done / files.length) * 100),
      stage: "extracting",
      pagesDone: done,
    });
  }
  return out;
}

/**
 * v1 remove-only. Names absent from the document are skipped silently (the UI
 * sends names it just listed, so a miss means the file changed underneath).
 * An empty removeNames list is a no-op copy, valid because the schema defaults
 * it to [].
 *
 * Removal is logical, not byte-level: it drops the name-tree entry and the /AF
 * reference, but pdf-lib still serializes the now-unreferenced embedded-file
 * stream, so its bytes stay in the file until a rewrite pass (compress or
 * rasterize) rebuilds it. Task 9 should surface this on the edit-attachments
 * screen.
 */
export async function runEditAttachments(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, removeNames } = EditAttachmentsInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath);
  for (const name of removeNames) {
    assertNotCancelled(ctx);
    removeEmbeddedFile(doc, name);
  }

  return savePdf(doc, outDir, "edited.pdf");
}
