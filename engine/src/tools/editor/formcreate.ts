import { degrees, StandardFonts } from "pdf-lib";
import type { PDFDocument, PDFPage } from "pdf-lib";
import { FormCreateInputSchema } from "@pogopdf/contracts";
import type { FormCreateField } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled, invalidInput, normalizeAngle } from "../organize/organize";
import { displayedPageSize, toUnrotated } from "../../render/pagegeometry";
import { loadPdf, savePdf } from "../pdfdoc";
import { encodeFailure } from "../edit/pagedraw";

const CANONICAL = new Set([0, 90, 180, 270]);
/** Label baseline offset below the widget's displayed bottom edge. */
const LABEL_GAP = 4;
const LABEL_SIZE = 9;

type DisplayedPage = {
  rotation: number;
  mediaW: number;
  mediaH: number;
};

function displayedPage(doc: PDFDocument, pageIndex: number): DisplayedPage {
  const page = doc.getPage(pageIndex);
  const raw = normalizeAngle(page.getRotation().angle);
  const rotation = CANONICAL.has(raw) ? raw : 0;
  const { width: mediaW, height: mediaH } = page.getSize();
  return { rotation, mediaW, mediaH };
}

/** The smallest user-space box containing a displayed-frame rect. */
function toUserRect(
  disp: DisplayedPage,
  rect: { x: number; y: number; w: number; h: number }
): { x: number; y: number; width: number; height: number } {
  const a = toUnrotated(disp.rotation, disp.mediaW, disp.mediaH, rect.x, rect.y);
  const b = toUnrotated(disp.rotation, disp.mediaW, disp.mediaH, rect.x + rect.w, rect.y + rect.h);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function addField(
  doc: PDFDocument,
  page: PDFPage,
  pageIndex: number,
  field: FormCreateField
): void {
  const disp = displayedPage(doc, pageIndex);
  const rect = toUserRect(disp, { x: field.x, y: field.y, w: field.w, h: field.h });
  const form = doc.getForm();
  const options = { ...rect, borderWidth: 0 };

  try {
    if (field.type === "text") {
      form.createTextField(field.name).addToPage(page, options);
    } else if (field.type === "checkbox") {
      form.createCheckBox(field.name).addToPage(page, options);
    } else {
      const dropdown = form.createDropdown(field.name);
      dropdown.addOptions(field.options ?? []);
      dropdown.addToPage(page, options);
    }
  } catch (e) {
    // pdf-lib throws a plain error for a duplicate field name.
    const msg = e instanceof Error ? e.message : String(e);
    throw /already exists/i.test(msg)
      ? invalidInput(`A field named "${field.name}" already exists`)
      : e;
  }
}

/**
 * Create AcroForm fields at displayed-frame coordinates. pdf-lib fields carry
 * no separate label, so each label is DRAWN as page text just below the widget.
 * Coordinates are mapped from the displayed frame to user space so a field on a
 * /Rotate page lands where the user placed it.
 */
export async function runFormCreate(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, fields, page } = FormCreateInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath);
  const pageCount = doc.getPageCount();
  if (page > pageCount) {
    throw invalidInput(`Page ${page} is out of range (1-${pageCount})`);
  }
  const pageIndex = page - 1;
  const target = doc.getPage(pageIndex);
  const disp = displayedPage(doc, pageIndex);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const field of fields) {
    assertNotCancelled(ctx);
    addField(doc, target, pageIndex, field);

    if (field.label) {
      const [rx, ry] = [field.x, field.y + field.h + LABEL_GAP];
      const { x, y } = toUnrotated(disp.rotation, disp.mediaW, disp.mediaH, rx, ry);
      try {
        target.drawText(field.label, {
          x,
          y,
          size: LABEL_SIZE,
          font,
          // Counter the page /Rotate so the label reads upright in the viewer.
          rotate: degrees(disp.rotation),
        });
      } catch (err) {
        throw encodeFailure(err) ?? err;
      }
    }
  }

  return savePdf(doc, outDir, "form.pdf");
}
