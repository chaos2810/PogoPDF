import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { pickFiles } from "../../app/rpc";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, NumberInput } from "../organize/forms";

export function TextToPdfScreen() {
  const [fontSize, setFontSize] = useState(12);
  const [margins, setMargins] = useState(72);

  const fontSizeInvalid = !Number.isInteger(fontSize) || fontSize < 6 || fontSize > 72;
  const marginsInvalid = !Number.isFinite(margins) || margins < 0 || margins > 144;

  return (
    <FileToolScreen
      toolId={TOOL_IDS.textToPdf}
      acceptMultiple={false}
      ctaKey="tool.textToPdf.cta"
      extensions={["txt"]}
      pick={() => pickFiles(false, "txt")}
      dropKeys={{
        multiple: "tool.textToPdf.drop",
        single: "tool.textToPdf.dropSingle",
      }}
      validationError={() =>
        fontSizeInvalid
          ? "tool.textToPdf.fontSizeInvalid"
          : marginsInvalid
            ? "tool.textToPdf.marginsInvalid"
            : null
      }
      buildInput={(files) => ({ filePath: files[0], fontSize, margins })}
      options={
        <>
          <Field labelKey="tool.textToPdf.fontSize">
            <NumberInput
              testId="texttopdf-fontsize"
              value={fontSize}
              onChange={setFontSize}
              min={6}
              max={72}
              invalid={fontSizeInvalid}
            />
          </Field>
          <Field labelKey="tool.textToPdf.margins" hintKey="tool.textToPdf.marginsHint">
            <NumberInput
              testId="texttopdf-margins"
              value={margins}
              onChange={setMargins}
              min={0}
              max={144}
              invalid={marginsInvalid}
            />
          </Field>
          <Hint keyName="tool.textToPdf.formatHint" stacked />
        </>
      }
    />
  );
}
