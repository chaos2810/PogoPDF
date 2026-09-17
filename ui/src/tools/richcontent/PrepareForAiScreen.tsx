import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, TextInput } from "../organize/forms";
import { validateOptionalPageSpec } from "../pagespec";

export function PrepareForAiScreen() {
  const [pages, setPages] = useState("");

  return (
    <FileToolScreen
      toolId={TOOL_IDS.prepareForAi}
      acceptMultiple={false}
      ctaKey="tool.prepareForAi.cta"
      validationError={() => validateOptionalPageSpec(pages)}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0] };
        if (pages.trim()) input.pages = pages;
        return input;
      }}
      options={
        <>
          <Field
            labelKey="tool.prepareForAi.pages"
            hintKey="tool.prepareForAi.pagesHint"
          >
            <TextInput
              testId="prepareai-pages"
              value={pages}
              onChange={setPages}
              placeholder="1-3,5"
            />
          </Field>
        </>
      }
    />
  );
}
