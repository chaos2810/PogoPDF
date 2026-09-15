import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, NumberInput, RadioGroup } from "./forms";
type Size = "match" | "a4";
type Orientation = "portrait" | "landscape";

export function AddBlankPageScreen() {
  const [position, setPosition] = useState(0);
  const [size, setSize] = useState<Size>("match");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const invalid = !Number.isInteger(position) || position < 0;
  return (
    <FileToolScreen
      toolId={TOOL_IDS.addBlankPage}
      acceptMultiple={false}
      ctaKey="tool.addBlankPage.cta"
      validationError={() => (invalid ? "tool.addBlankPage.positionInvalid" : null)}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0], position, size };
        if (size === "a4") input.orientation = orientation;
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.addBlankPage.position">
            <NumberInput
              testId="addblank-position"
              value={position}
              onChange={setPosition}
              min={0}
              invalid={invalid}
            />
          </Field>
          <Hint keyName="tool.addBlankPage.positionHint" />
          <Field labelKey="tool.addBlankPage.size">
            <RadioGroup
              name="addblank-size"
              value={size}
              onChange={(v) => setSize(v as Size)}
              choices={[
                { value: "match", labelKey: "tool.addBlankPage.sizeMatch" },
                { value: "a4", labelKey: "tool.addBlankPage.sizeA4" },
              ]}
            />
          </Field>
          <Field labelKey="tool.addBlankPage.orientation">
            <RadioGroup
              name="addblank-orientation"
              value={orientation}
              onChange={(v) => setOrientation(v as Orientation)}
              disabled={size !== "a4"}
              choices={[
                { value: "portrait", labelKey: "tool.addBlankPage.portrait" },
                { value: "landscape", labelKey: "tool.addBlankPage.landscape" },
              ]}
            />
          </Field>
        </>
      }
    />
  );
}
