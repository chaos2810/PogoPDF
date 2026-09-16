import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, TextInput } from "../organize/forms";
import { validateOptionalPageSpec } from "../pagespec";

export function PdfToTextScreen() {
  const [pages, setPages] = useState("");
  return (
    <FileToolScreen
      toolId={TOOL_IDS.pdfToText}
      acceptMultiple={false}
      ctaKey="tool.pdfToText.cta"
      validationError={() => validateOptionalPageSpec(pages)}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0] };
        if (pages.trim()) input.pages = pages;
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.pdfToText.pages">
            <TextInput
              testId="pdftotext-pages"
              value={pages}
              onChange={setPages}
              placeholder="1-3,5"
            />
          </Field>
          <Hint keyName="tool.pdfToText.pagesHint" />
        </>
      }
    />
  );
}
