import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, TextInput } from "./forms";
import { validatePageSpec } from "../pagespec";

export function ExtractPagesScreen() {
  const [pages, setPages] = useState("");
  return (
    <FileToolScreen
      toolId={TOOL_IDS.extractPages}
      acceptMultiple={false}
      ctaKey="tool.extractPages.cta"
      validationError={() => validatePageSpec(pages)}
      buildInput={(files) => ({ filePath: files[0], pages })}
      options={
        <Field labelKey="tool.extractPages.pages">
          <TextInput testId="extract-pages" value={pages} onChange={setPages} placeholder="1-3,5" />
        </Field>
      }
    />
  );
}
