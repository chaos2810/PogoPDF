import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { pickEbookFiles } from "../../app/rpc";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, NumberInput } from "../organize/forms";

export function EbookToPdfScreen() {
  const [fontSize, setFontSize] = useState(12);
  const [margins, setMargins] = useState(72);

  const fontSizeInvalid = !Number.isInteger(fontSize) || fontSize < 6 || fontSize > 72;
  const marginsInvalid = !Number.isFinite(margins) || margins < 0 || margins > 144;

  return (
    <FileToolScreen
      toolId={TOOL_IDS.ebookToPdf}
      acceptMultiple={false}
      ctaKey="tool.ebookToPdf.cta"
      extensions={["epub", "fb2"]}
      pick={() => pickEbookFiles(false)}
      dropKeys={{
        multiple: "tool.ebookToPdf.drop",
        single: "tool.ebookToPdf.dropSingle",
      }}
      validationError={() =>
        fontSizeInvalid
          ? "tool.ebookToPdf.fontSizeInvalid"
          : marginsInvalid
            ? "tool.ebookToPdf.marginsInvalid"
            : null
      }
      buildInput={(files) => ({ filePath: files[0], fontSize, margins })}
      options={
        <>
          <Field labelKey="tool.ebookToPdf.fontSize">
            <NumberInput
              testId="ebook-fontsize"
              value={fontSize}
              onChange={setFontSize}
              min={6}
              max={72}
              invalid={fontSizeInvalid}
            />
          </Field>
          <Field labelKey="tool.ebookToPdf.margins" hintKey="tool.ebookToPdf.marginsHint">
            <NumberInput
              testId="ebook-margins"
              value={margins}
              onChange={setMargins}
              min={0}
              max={144}
              invalid={marginsInvalid}
            />
          </Field>
          <Hint keyName="tool.ebookToPdf.formatHint" stacked />
        </>
      }
    />
  );
}
