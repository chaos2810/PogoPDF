import { describe, it, expect } from "vitest";
import type { FormFieldsData } from "@pogopdf/contracts";
import { buildFormFillValues } from "./formfillValues";

type FormField = FormFieldsData["fields"][number];

const field = (init: Partial<FormField> & Pick<FormField, "name" | "type">): FormField => ({
  readOnly: false,
  required: false,
  ...init,
});

describe("buildFormFillValues", () => {
  it("omits an unselected radio and dropdown instead of sending an empty value", () => {
    const fields = [
      field({ name: "choice", type: "radio", options: ["A", "B"] }),
      field({ name: "pick", type: "dropdown", options: ["X", "Y"] }),
    ];
    // Seeded with "" by the screen, so an untouched choice has an empty value.
    expect(buildFormFillValues(fields, { choice: "", pick: "" })).toEqual([]);
  });

  it("sends a selected radio and dropdown option", () => {
    const fields = [
      field({ name: "choice", type: "radio", options: ["A", "B"] }),
      field({ name: "pick", type: "dropdown", options: ["X", "Y"] }),
    ];
    expect(buildFormFillValues(fields, { choice: "B", pick: "Y" })).toEqual([
      { name: "choice", value: "B" },
      { name: "pick", value: "Y" },
    ]);
  });

  it("keeps an empty text fill (it clears the field)", () => {
    expect(buildFormFillValues([field({ name: "title", type: "text" })], { title: "" })).toEqual([
      { name: "title", value: "" },
    ]);
  });

  it("keeps an unchecked checkbox as an explicit false", () => {
    expect(
      buildFormFillValues([field({ name: "agree", type: "checkbox" })], { agree: "false" })
    ).toEqual([{ name: "agree", value: "false" }]);
  });

  it("excludes read-only and signature fields", () => {
    const fields = [
      field({ name: "lo", type: "text", readOnly: true }),
      field({ name: "sig", type: "signature" }),
      field({ name: "name", type: "text" }),
    ];
    expect(buildFormFillValues(fields, { lo: "x", name: "Ada" })).toEqual([
      { name: "name", value: "Ada" },
    ]);
  });
});
