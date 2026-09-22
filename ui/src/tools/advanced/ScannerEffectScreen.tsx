import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, RadioGroup } from "../organize/forms";

type Preset = "bw" | "gray" | "faded";

export function ScannerEffectScreen() {
  const [preset, setPreset] = useState<Preset>("gray");

  return (
    <FileToolScreen
      toolId={TOOL_IDS.scannerEffect}
      acceptMultiple={false}
      ctaKey="tool.scannerEffect.cta"
      buildInput={(files) => ({ filePath: files[0], preset })}
      options={
        <>
          <Field labelKey="tool.scannerEffect.preset">
            <RadioGroup
              name="scanner-preset"
              value={preset}
              onChange={(v) => setPreset(v as Preset)}
              choices={[
                { value: "bw", labelKey: "tool.scannerEffect.presetBw" },
                { value: "gray", labelKey: "tool.scannerEffect.presetGray" },
                { value: "faded", labelKey: "tool.scannerEffect.presetFaded" },
              ]}
            />
          </Field>
          <Hint keyName="tool.scannerEffect.hint" stacked />
        </>
      }
    />
  );
}
