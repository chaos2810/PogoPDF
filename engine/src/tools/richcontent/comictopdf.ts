import { extname, join } from "node:path";
import { readFile, writeFile, rm } from "node:fs/promises";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { ComicToPdfInputSchema, TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { loadImageEmbeddable } from "../../render/decode";
import { assertNotCancelled } from "../organize/organize";
import { addFitImagePage } from "../convertin/imagestopdf";
import { savePdf } from "../pdfdoc";

/** Image entry extensions a comic archive may hold (the v1 image formats). */
const IMAGE_EXT = /\.(png|jpe?g|jfif|webp|gif|bmp|tiff?)$/i;

function corrupt(message: string): Error {
  return Object.assign(new Error(message), { code: TOOL_ERROR_CODES.CORRUPT_PDF });
}

function unsupported(message: string): Error {
  return Object.assign(new Error(message), { code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT });
}

/**
 * CBZ -> PDF: every image entry becomes one page sized to the image and drawn
 * 1:1 (the imagesToPdf "fit" path). Entries are ordered by name so page order
 * matches comic readers, which sort lexically. A zip with no image entries is
 * UNSUPPORTED_FORMAT; unreadable zip bytes are CORRUPT_PDF. CBR (rar) is not
 * supported in v1.
 */
export async function runComicToPdf(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath } = ComicToPdfInputSchema.parse(input);
  assertNotCancelled(ctx);

  let entries: JSZip.JSZipObject[];
  try {
    const zip = await JSZip.loadAsync(await readFile(filePath));
    entries = Object.values(zip.files)
      .filter((entry) => !entry.dir && IMAGE_EXT.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw corrupt(`Cannot read comic archive ${filePath}: ${msg}`);
  }
  if (entries.length === 0) {
    throw unsupported(`Comic archive has no image entries: ${filePath}`);
  }

  const out = await PDFDocument.create();
  for (let i = 0; i < entries.length; i++) {
    assertNotCancelled(ctx);
    // loadImageEmbeddable is path-based; a comic entry is decoded through a
    // scratch file so the verified decode/sniff/transcode pipeline is reused
    // verbatim rather than reimplemented for buffers.
    const scratchPath = join(outDir, `comic-entry-${String(i).padStart(4, "0")}${extname(entries[i].name)}`);
    await writeFile(scratchPath, await entries[i].async("nodebuffer"));
    try {
      const { bytes, kind, widthPx, heightPx } = await loadImageEmbeddable(scratchPath);
      const image = kind === "jpg" ? await out.embedJpg(bytes) : await out.embedPng(bytes);
      addFitImagePage(out, image, widthPx, heightPx, 0);
    } finally {
      await rm(scratchPath, { force: true });
    }

    const done = i + 1;
    ctx.notifyProgress({
      jobId: "",
      percent: Math.round((done / entries.length) * 100),
      stage: "converting",
      pagesDone: done,
    });
  }

  return savePdf(out, outDir, "comic.pdf");
}
