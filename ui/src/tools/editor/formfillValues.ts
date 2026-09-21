import type { FormFieldsData } from "@pogopdf/contracts";

type FormField = FormFieldsData["fields"][number];

/**
 * Build the formFill payload from the live fields and control values.
 *
 * Read-only and signature fields are never filled. An unselected radio or
 * dropdown is omitted entirely so the engine leaves the field unset; a ""
 * value names no option and would always fail with INVALID_INPUT. Text fields
 * keep sending "", since an empty text fill legitimately clears the field.
 */
export function buildFormFillValues(
  fields: FormField[],
  values: Record<string, string>
): Array<{ name: string; value: string }> {
  return fields
    .filter((f) => !f.readOnly && f.type !== "signature")
    .filter((f) => {
      if (f.type !== "radio" && f.type !== "dropdown") return true;
      return (values[f.name] ?? "").length > 0;
    })
    .map((f) => ({ name: f.name, value: values[f.name] ?? "" }));
}
