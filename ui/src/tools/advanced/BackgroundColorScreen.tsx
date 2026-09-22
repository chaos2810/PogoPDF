import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, TextInput } from "../organize/forms";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function BackgroundColorScreen() {
  const [color, setColor] = useState("#FFFFFF");
  const colorInvalid = !HEX_RE.test(color);

  return (
    <FileToolScreen
      toolId={TOOL_IDS.backgroundColor}
      acceptMultiple={false}
      ctaKey="tool.backgroundColor.cta"
      validationError={() => (colorInvalid ? "tool.backgroundColor.colorInvalid" : null)}
      buildInput={(files) => ({ filePath: files[0], color })}
      options={
        <>
          <Field labelKey="tool.backgroundColor.color">
            <TextInput
              testId="bgcolor-color"
              value={color}
              onChange={setColor}
              placeholder="#FFFFFF"
              style={{ borderColor: colorInvalid ? "var(--danger)" : "var(--border)" }}
            />
          </Field>
          <Hint keyName="tool.backgroundColor.hint" stacked />
        </>
      }
    />
  );
}
