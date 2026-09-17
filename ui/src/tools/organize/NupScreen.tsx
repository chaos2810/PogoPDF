import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, NumberInput, Select } from "./forms";

const LAYOUTS = ["2x1", "1x2", "2x2", "3x3", "4x4"] as const;

export function NupScreen() {
  const [layout, setLayout] = useState<string>("2x2");
  const [margin, setMargin] = useState(6);
  const invalid = !Number.isFinite(margin) || margin < 0 || margin > 72;
  return (
    <FileToolScreen
      toolId={TOOL_IDS.nup}
      acceptMultiple={false}
      ctaKey="tool.nup.cta"
      validationError={() => (invalid ? "tool.nup.marginInvalid" : null)}
      buildInput={(files) => ({ filePath: files[0], layout, margin })}
      options={
        <>
          <Field labelKey="tool.nup.layout">
            <Select
              testId="nup-layout"
              value={layout}
              onChange={setLayout}
              options={LAYOUTS.map((l) => ({ value: l, label: l }))}
            />
          </Field>
          <Field labelKey="tool.nup.margin" hintKey="tool.nup.marginHint">
            <NumberInput
              testId="nup-margin"
              value={margin}
              onChange={setMargin}
              min={0}
              max={72}
              invalid={invalid}
            />
          </Field>
        </>
      }
    />
  );
}
