import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, TextInput } from "../organize/forms";
import { validateOptionalPageSpec } from "../pagespec";

export function PdfToMarkdownScreen() {
  const [pages, setPages] = useState("");

  return (
    <FileToolScreen
      toolId={TOOL_IDS.pdfToMarkdown}
      acceptMultiple={false}
      ctaKey="tool.pdfToMarkdown.cta"
      footnoteKey="tool.pdfToMarkdown.hint"
      validationError={() => validateOptionalPageSpec(pages)}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0] };
        if (pages.trim()) input.pages = pages;
        return input;
      }}
      options={
        <Field
          labelKey="tool.pdfToMarkdown.pages"
          hintKey="tool.pdfToMarkdown.pagesHint"
        >
          <TextInput
            testId="pdftomarkdown-pages"
            value={pages}
            onChange={setPages}
            placeholder="1-3,5"
          />
        </Field>
      }
    />
  );
}
