import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, TextInput } from "../organize/forms";
import { validateOptionalPageSpec } from "../pagespec";

export function PdfToGreyscaleScreen() {
  const [pages, setPages] = useState("");
  return (
    <FileToolScreen
      toolId={TOOL_IDS.pdfToGreyscale}
      acceptMultiple={false}
      ctaKey="tool.pdfToGreyscale.cta"
      validationError={() => validateOptionalPageSpec(pages)}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0] };
        if (pages.trim()) input.pages = pages;
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.pdfToGreyscale.pages">
            <TextInput
              testId="pdftogreyscale-pages"
              value={pages}
              onChange={setPages}
              placeholder="1-3,5"
            />
          </Field>
          <Hint keyName="tool.pdfToGreyscale.pagesHint" />
          <Hint keyName="tool.pdfToGreyscale.rasterHint" />
        </>
      }
    />
  );
}
