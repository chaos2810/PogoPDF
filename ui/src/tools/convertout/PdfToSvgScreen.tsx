import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, NumberInput, TextInput } from "../organize/forms";
import { validateOptionalPageSpec } from "../pagespec";

export function PdfToSvgScreen() {
  const [dpi, setDpi] = useState(150);
  const [pages, setPages] = useState("");

  const dpiInvalid = !Number.isFinite(dpi) || dpi < 72 || dpi > 600;
  const error = dpiInvalid ? "tool.pdfToSvg.dpiInvalid" : validateOptionalPageSpec(pages);

  return (
    <FileToolScreen
      toolId={TOOL_IDS.pdfToSvg}
      acceptMultiple={false}
      ctaKey="tool.pdfToSvg.cta"
      validationError={() => error}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0], dpi };
        if (pages.trim()) input.pages = pages;
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.pdfToSvg.dpi">
            <NumberInput
              testId="pdftosvg-dpi"
              value={dpi}
              onChange={setDpi}
              min={72}
              max={600}
              invalid={dpiInvalid}
            />
          </Field>
          <Field labelKey="tool.pdfToSvg.pages">
            <TextInput
              testId="pdftosvg-pages"
              value={pages}
              onChange={setPages}
              placeholder="1-3,5"
            />
          </Field>
          <Hint keyName="tool.pdfToSvg.pagesHint" />
          <Hint keyName="tool.pdfToSvg.rasterHint" />
        </>
      }
    />
  );
}
