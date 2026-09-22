import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, TextInput } from "../organize/forms";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function ChangeTextColorScreen() {
  const [color, setColor] = useState("#000000");
  const colorInvalid = !HEX_RE.test(color);

  return (
    <FileToolScreen
      toolId={TOOL_IDS.changeTextColor}
      acceptMultiple={false}
      ctaKey="tool.changeTextColor.cta"
      validationError={() => (colorInvalid ? "tool.changeTextColor.colorInvalid" : null)}
      buildInput={(files) => ({ filePath: files[0], color })}
      options={
        <>
          <Field labelKey="tool.changeTextColor.color">
            <TextInput
              testId="textcolor-color"
              value={color}
              onChange={setColor}
              placeholder="#000000"
              style={{ borderColor: colorInvalid ? "var(--danger)" : "var(--border)" }}
            />
          </Field>
          <Hint keyName="tool.changeTextColor.approximationHint" stacked />
        </>
      }
    />
  );
}
