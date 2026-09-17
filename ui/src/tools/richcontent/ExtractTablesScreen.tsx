import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, RadioGroup, TextInput } from "../organize/forms";
import { validateOptionalPageSpec } from "../pagespec";

type Format = "csv" | "json" | "markdown";

export function ExtractTablesScreen() {
  const [format, setFormat] = useState<Format>("csv");
  const [pages, setPages] = useState("");

  return (
    <FileToolScreen
      toolId={TOOL_IDS.extractTables}
      acceptMultiple={false}
      ctaKey="tool.extractTables.cta"
      validationError={() => validateOptionalPageSpec(pages)}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0], format };
        if (pages.trim()) input.pages = pages;
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.extractTables.format">
            <RadioGroup
              name="extracttables-format"
              value={format}
              onChange={(v) => setFormat(v as Format)}
              choices={[
                { value: "csv", labelKey: "tool.extractTables.formatCsv" },
                { value: "json", labelKey: "tool.extractTables.formatJson" },
                { value: "markdown", labelKey: "tool.extractTables.formatMarkdown" },
              ]}
            />
          </Field>
          <Field labelKey="tool.extractTables.pages">
            <TextInput
              testId="extracttables-pages"
              value={pages}
              onChange={setPages}
              placeholder="1-3,5"
            />
          </Field>
          <Hint keyName="tool.extractTables.pagesHint" />
          <div style={{ gridColumn: "1 / -1" }}>
            <Hint keyName="tool.extractTables.hint" stacked />
          </div>
        </>
      }
    />
  );
}
