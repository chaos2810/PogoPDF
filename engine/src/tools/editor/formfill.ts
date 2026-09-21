import {
  PDFBool,
  PDFCheckBox,
  PDFDropdown,
  PDFName,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";
import type { PDFDocument, PDFField } from "pdf-lib";
import { FormFillInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled, invalidInput } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";

/**
 * Apply one { name, value } pair. Every mismatch is INVALID_INPUT naming the
 * field (and for choice fields the offending option), never a raw pdf-lib
 * throw, so the UI can show a useful message.
 */
function applyValue(doc: PDFDocument, name: string, value: string): void {
  const field: PDFField = doc.getForm().getField(name);

  if (field instanceof PDFTextField) {
    field.setText(value);
    return;
  }

  if (field instanceof PDFCheckBox) {
    const normalized = value.toLowerCase();
    if (normalized === "true") field.check();
    else if (normalized === "false") field.uncheck();
    else throw invalidInput(`Checkbox field "${name}" expects "true" or "false", got "${value}"`);
    return;
  }

  if (field instanceof PDFRadioGroup) {
    if (!field.getOptions().includes(value)) {
      throw invalidInput(`Radio field "${name}" has no option "${value}"`);
    }
    field.select(value);
    return;
  }

  if (field instanceof PDFDropdown) {
    if (!field.getOptions().includes(value)) {
      throw invalidInput(`Dropdown field "${name}" has no option "${value}"`);
    }
    field.select(value);
    return;
  }

  throw invalidInput(`Field "${name}" cannot be filled (unsupported field type)`);
}

/**
 * Fill an AcroForm in place and save "filled.pdf". The form stays fillable:
 * fields are not flattened. NeedAppearances is set so viewers that do not
 * trust the embedded appearance streams regenerate them from the values.
 */
export async function runFormFill(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, values } = FormFillInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath);
  const form = doc.getForm();
  for (const { name, value } of values) {
    assertNotCancelled(ctx);
    // getField throws for an unknown name; convert that into a typed error
    // naming the field so the UI can point at the row that failed.
    if (form.getFieldMaybe(name) === undefined) {
      throw invalidInput(`Form has no field named "${name}"`);
    }
    applyValue(doc, name, value);
  }

  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  return savePdf(doc, outDir, "filled.pdf");
}
