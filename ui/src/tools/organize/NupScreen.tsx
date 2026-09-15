import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, NumberInput } from "./forms";

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
            <select
              data-testid="nup-layout"
              value={layout}
              onChange={(e) => setLayout(e.target.value)}
              style={{
                padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--bg)", color: "var(--text)", fontSize: 14,
              }}
            >
              {LAYOUTS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </Field>
          <Field labelKey="tool.nup.margin">
            <NumberInput
              testId="nup-margin"
              value={margin}
              onChange={setMargin}
              min={0}
              max={72}
              invalid={invalid}
            />
          </Field>
          <Hint keyName="tool.nup.marginHint" />
        </>
      }
    />
  );
}
