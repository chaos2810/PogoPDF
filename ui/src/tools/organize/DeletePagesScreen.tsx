import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, TextInput } from "./forms";
import { validatePageSpec } from "../pagespec";

export function DeletePagesScreen() {
  const [pages, setPages] = useState("");
  return (
    <FileToolScreen
      toolId={TOOL_IDS.deletePages}
      acceptMultiple={false}
      ctaKey="tool.deletePages.cta"
      validationError={() => validatePageSpec(pages)}
      buildInput={(files) => ({ filePath: files[0], pages })}
      options={
        <Field labelKey="tool.deletePages.pages">
          <TextInput testId="delete-pages" value={pages} onChange={setPages} placeholder="1-3,5" />
        </Field>
      }
    />
  );
}
