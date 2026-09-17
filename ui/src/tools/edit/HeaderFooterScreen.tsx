import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, NumberInput, TextInput } from "../organize/forms";
import { validateOptionalPageSpec } from "../pagespec";

export function HeaderFooterScreen() {
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [fontSize, setFontSize] = useState(10);
  const [margin, setMargin] = useState(28);
  const [pages, setPages] = useState("");

  const fontSizeInvalid = !Number.isInteger(fontSize) || fontSize < 6 || fontSize > 72;
  const marginInvalid = !Number.isFinite(margin) || margin < 0 || margin > 144;

  const error =
    !header.trim() && !footer.trim()
      ? "tool.headerFooter.required"
      : fontSizeInvalid
        ? "tool.headerFooter.fontSizeInvalid"
        : marginInvalid
          ? "tool.headerFooter.marginInvalid"
          : validateOptionalPageSpec(pages);

  return (
    <FileToolScreen
      toolId={TOOL_IDS.headerFooter}
      acceptMultiple={false}
      ctaKey="tool.headerFooter.cta"
      validationError={() => error}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0], fontSize, margin };
        if (header.trim()) input.header = header;
        if (footer.trim()) input.footer = footer;
        if (pages.trim()) input.pages = pages;
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.headerFooter.header">
            <TextInput testId="headerfooter-header" value={header} onChange={setHeader} />
          </Field>
          <Field labelKey="tool.headerFooter.footer">
            <TextInput testId="headerfooter-footer" value={footer} onChange={setFooter} />
          </Field>
          {/* One shared note spans both text columns, so neither column's hint
              wraps and pushes its next field row out of rhythm. */}
          <div style={{ gridColumn: "1 / -1" }}>
            <Hint keyName="tool.headerFooter.latinHint" stacked />
          </div>
          <Field labelKey="tool.headerFooter.fontSize">
            <NumberInput
              testId="headerfooter-fontsize"
              value={fontSize}
              onChange={setFontSize}
              min={6}
              max={72}
              invalid={fontSizeInvalid}
            />
          </Field>
          <Field labelKey="tool.headerFooter.margin" hintKey="tool.headerFooter.marginHint">
            <NumberInput
              testId="headerfooter-margin"
              value={margin}
              onChange={setMargin}
              min={0}
              max={144}
              invalid={marginInvalid}
            />
          </Field>
          <Field labelKey="tool.headerFooter.pages">
            <TextInput
              testId="headerfooter-pages"
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
