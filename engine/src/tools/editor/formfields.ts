import {
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
} from "pdf-lib";
import type { PDFField } from "pdf-lib";
import { FormFieldsInputSchema } from "@pogopdf/contracts";
import type { FormFieldsData } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { loadPdf } from "../pdfdoc";

export type { FormFieldsData };

/** Readable text for a field's current value; undefined when unset/off. */
function fieldValue(field: PDFField): string | undefined {
  if (field instanceof PDFTextField) return field.getText();
  if (field instanceof PDFCheckBox) return field.isChecked() ? "true" : "false";
  if (field instanceof PDFRadioGroup) return field.getSelected();
  if (field instanceof PDFDropdown) {
    const [selected] = field.getSelected();
    return selected;
  }
  return undefined;
}

/**
 * Enumerate a PDF's AcroForm fields. A document with no fields yields an
 * empty list, not an error: the UI shows an empty state.
 */
export async function runFormFields(
  input: unknown,
  ctx: RpcCtx,
  _outDir: string
): Promise<FormFieldsData> {
  const { filePath } = FormFieldsInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(filePath, { updateMetadata: false });
  const fields: FormFieldsData["fields"] = [];

  for (const field of doc.getForm().getFields()) {
    const entry: FormFieldsData["fields"][number] = {
      name: field.getName(),
      type: "text",
      readOnly: field.isReadOnly(),
      required: field.isRequired(),
    };
    if (field instanceof PDFTextField) entry.type = "text";
    else if (field instanceof PDFCheckBox) entry.type = "checkbox";
    else if (field instanceof PDFRadioGroup) {
      entry.type = "radio";
      entry.options = field.getOptions();
    } else if (field instanceof PDFDropdown) {
      entry.type = "dropdown";
      entry.options = field.getOptions();
    } else if (field instanceof PDFSignature) entry.type = "signature";

    const value = fieldValue(field);
    if (value !== undefined) entry.value = value;
    fields.push(entry);
  }

  return { fields };
}
