import { existsSync } from "node:fs";
import { join } from "node:path";
import { EditTextInputSchema } from "@pogopdf/contracts";
import type { ProgressParams } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { corrupt } from "../errors";
import { assertNotCancelled } from "../organize/organize";
import { editTextFile } from "../../textedit/pymupdf";
import type { TextEdit } from "../../textedit/pymupdf";

/**
 * In-place text edit: each input edit's quad (page points, unrotated frame, see
 * EditTextInputSchema) becomes a PyMuPDF rect. PyMuPDF holds one interpreter per
 * process, so this must stay on the engine's serial job queue (it does: every
 * tool runs through the JobQueue's single drain loop). One PyMuPDF call edits
 * the whole list, so progress and cancellation fire per edit from inside it.
 */
export async function runEditText(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, edits } = EditTextInputSchema.parse(input);
  assertNotCancelled(ctx);
  if (!existsSync(filePath)) throw corrupt(`File not found: ${filePath}`);

  // The schema is 1-based (matching every other tool); PyMuPDF is 0-based.
  const pyEdits: TextEdit[] = edits.map((e) => ({
    page: e.page - 1,
    quad: { x0: e.quad.x, y0: e.quad.y, x1: e.quad.x + e.quad.w, y1: e.quad.y + e.quad.h },
    newText: e.newText,
  }));

  const outPath = join(outDir, "edited.pdf");
  await editTextFile(filePath, pyEdits, outPath, {
    // assertNotCancelled throws the typed CANCELLED error; the wrapper maps its
    // Python cancel marker to the same shape.
    shouldCancel: () => {
      try {
        assertNotCancelled(ctx);
        return false;
      } catch {
        return true;
      }
    },
    onEdit: (done, total) => {
      ctx.notifyProgress({
        jobId: "",
        percent: Math.round((done / total) * 100),
        stage: "editing",
        pagesDone: done,
      } satisfies ProgressParams);
    },
  });
  return outPath;
}
