import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { pickFiles } from "../../app/rpc";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, NumberInput } from "../organize/forms";

export function MarkdownToPdfScreen() {
  const [fontSize, setFontSize] = useState(12);
  const [margins, setMargins] = useState(72);

  const fontSizeInvalid = !Number.isInteger(fontSize) || fontSize < 6 || fontSize > 72;
  const marginsInvalid = !Number.isFinite(margins) || margins < 0 || margins > 144;

  return (
    <FileToolScreen
      toolId={TOOL_IDS.markdownToPdf}
      acceptMultiple={false}
      ctaKey="tool.markdownToPdf.cta"
      extensions={["md", "markdown"]}
      pick={() => pickFiles(false, "md,markdown")}
      dropKeys={{
        multiple: "tool.markdownToPdf.drop",
        single: "tool.markdownToPdf.dropSingle",
      }}
      validationError={() =>
        fontSizeInvalid
          ? "tool.markdownToPdf.fontSizeInvalid"
          : marginsInvalid
            ? "tool.markdownToPdf.marginsInvalid"
            : null
      }
      buildInput={(files) => ({ filePath: files[0], fontSize, margins })}
      options={
        <>
          <Field labelKey="tool.markdownToPdf.fontSize">
            <NumberInput
              testId="markdowntopdf-fontsize"
              value={fontSize}
              onChange={setFontSize}
              min={6}
              max={72}
              invalid={fontSizeInvalid}
            />
          </Field>
          <Field labelKey="tool.markdownToPdf.margins" hintKey="tool.markdownToPdf.marginsHint">
            <NumberInput
              testId="markdowntopdf-margins"
              value={margins}
              onChange={setMargins}
              min={0}
              max={144}
              invalid={marginsInvalid}
            />
          </Field>
          <Hint keyName="tool.markdownToPdf.simpleHint" stacked />
        </>
      }
    />
  );
}
