import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, TextRenderingMode, setTextRenderingMode } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import { OcrInputSchema, parsePageSelection } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { encodeCanvas } from "../../render/encode";
import { createOcrWorker, runOcrPage, type OcrLine } from "../../render/ocr";
import { displayedPageSize } from "../../render/pagegeometry";
import { assertNotCancelled, normalizeAngle } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { openRenderer } from "../convertout/shared";

/**
 * Draw one recognized line as invisible text near where it appeared. Tesseract
 * boxes are in IMAGE pixels with y growing downward; the page image was
 * rendered at `dpi`, so points = pixels * 72 / dpi. The PDF y axis grows upward,
 * so the baseline's image y is measured down from the top.
 *
 * The layer is drawn with render mode 3 (Invisible): the glyphs are not painted
 * but remain in the content stream, so viewers can select and search them. This
 * is the PDF-native way to build a searchable layer, rather than relying on
 * zero opacity. Characters the standard font cannot encode (e.g. CJK, which
 * needs an embedded Unicode font we do not ship) cannot be drawn, so each word
 * is probed with `encodeText` and only the failing token is skipped; the line's
 * remaining words keep their positions from tesseract's word boxes. A line that
 * loses at least one word makes the layer incomplete and is counted so the job
 * can surface a warning. The plain-text mode is unaffected because it never
 * re-encodes anything.
 *
 * Returns 1 when the line lost at least one word, else 0. Lines without word
 * boxes (no recognition blocks) fall back to probing the whole line text.
 */
export function drawInvisibleLine(
  page: PDFPage,
  font: PDFFont,
  line: OcrLine,
  scale: number,
  pageHeightPt: number
): number {
  const size = Math.max(1, (line.bbox.y1 - line.bbox.y0) * scale);
  const y = pageHeightPt - line.baseline.y0 * scale;
  const words = line.words.length > 0 ? line.words : [{ text: line.text, bbox: line.bbox }];
  let lost = false;
  for (const word of words) {
    // tesseract text keeps trailing newlines; pdf-lib's encodeText rejects
    // control characters, so collapse whitespace before encoding.
    const text = word.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    try {
      font.encodeText(text);
    } catch {
      // pdf-lib throws for characters outside the font's encoding; skipping
      // only this token keeps the rest of the line searchable.
      lost = true;
      continue;
    }
    page.drawText(text, { x: word.bbox.x0 * scale, y, size, font });
  }
  return lost ? 1 : 0;
}

/**
 * Surface a searchable layer with dropped words. JobResultSchema is fixed at
 * {jobId, outputPath}, so the count travels on the progress channel: one final
 * notification with stage "ocr.droppedLines" and pagesDone = dropped count. The
 * UI (Task 9) observes it and shows a one-time "Latin-script only" hint.
 */
export function notifyDroppedLines(
  ctx: { notifyProgress: RpcCtx["notifyProgress"] },
  dropped: number
): void {
  if (dropped <= 0) return;
  ctx.notifyProgress({
    jobId: "",
    percent: 100,
    stage: "ocr.droppedLines",
    pagesDone: dropped,
  });
}

/**
 * OCR each selected page. `searchableOutput` (default) rebuilds the document as
 * page images with an invisible text layer; otherwise one plain .txt is written
 * per page (a multi-output job).
 *
 * A single tesseract worker is created for the whole job and terminated in a
 * finally block: worker startup loads the wasm core and language model and is
 * far more expensive than recognizing a page. Progress is reported per page and
 * cancellation is checked between pages.
 */
export async function runOcr(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string | string[]> {
  const { filePath, language, pages, dpi, searchableOutput } = OcrInputSchema.parse(input);
  assertNotCancelled(ctx);

  const src = searchableOutput ? await loadPdf(filePath) : undefined;
  const renderer = await openRenderer(filePath);
  let worker: Awaited<ReturnType<typeof createOcrWorker>> | undefined;
  try {
    worker = await createOcrWorker(language, dpi);
    const selected =
      pages === undefined
        ? Array.from({ length: renderer.pageCount }, (_, i) => i)
        : parsePageSelection(pages, renderer.pageCount);

    const out = searchableOutput ? await PDFDocument.create() : undefined;
    const font = out ? await out.embedFont(StandardFonts.Helvetica) : undefined;
    const stem = basename(filePath, extname(filePath));
    const txtPaths: string[] = [];
    // Lines with at least one word the standard font cannot encode; surfaced to
    // the UI so it can warn that the searchable layer is Latin-script only.
    let droppedLines = 0;

    for (let n = 0; n < selected.length; n++) {
      assertNotCancelled(ctx);
      const index = selected[n];
      const canvas = await renderer.renderPage(index, dpi);
      const png = await encodeCanvas(canvas, "png");
      const { text, lines } = await runOcrPage(png, worker);

      if (out && font && src) {
        const image = await out.embedPng(png);
        const { width, height } = src.getPage(index).getSize();
        const rotation = normalizeAngle(src.getPage(index).getRotation().angle);
        const displayed = displayedPageSize(rotation, width, height);
        const page = out.addPage([displayed.width, displayed.height]);
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: page.getWidth(),
          height: page.getHeight(),
        });

        const scale = 72 / dpi;
        page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
        for (const line of lines) {
          droppedLines += drawInvisibleLine(page, font, line, scale, page.getHeight());
        }
        page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
      } else {
        const txtPath = join(outDir, `${stem}-${n + 1}.txt`);
        await writeFile(txtPath, text);
        txtPaths.push(txtPath);
      }

      const done = n + 1;
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / selected.length) * 100),
        stage: "recognizing",
        pagesDone: done,
      });
    }

    if (searchableOutput) notifyDroppedLines(ctx, droppedLines);

    if (!out) return txtPaths;
    return await savePdf(out, outDir, "ocr.pdf");
  } finally {
    await worker?.terminate();
    await renderer.close();
  }
}
