import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, NumberInput } from "../organize/forms";

function percentInvalid(v: number): boolean {
  return !Number.isFinite(v) || v < -100 || v > 100;
}

export function AdjustColorsScreen() {
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [gamma, setGamma] = useState(1);

  const gammaInvalid = !Number.isFinite(gamma) || gamma < 0.1 || gamma > 3;
  const error = percentInvalid(brightness)
    ? "tool.adjustColors.percentInvalid"
    : percentInvalid(contrast)
      ? "tool.adjustColors.percentInvalid"
      : percentInvalid(saturation)
        ? "tool.adjustColors.percentInvalid"
        : gammaInvalid
          ? "tool.adjustColors.gammaInvalid"
          : null;

  return (
    <FileToolScreen
      toolId={TOOL_IDS.adjustColors}
      acceptMultiple={false}
      ctaKey="tool.adjustColors.cta"
      validationError={() => error}
      buildInput={(files) => ({ filePath: files[0], brightness, contrast, saturation, gamma })}
      options={
        <>
          <Field labelKey="tool.adjustColors.brightness">
            <NumberInput
              testId="adjustcolors-brightness"
              value={brightness}
              onChange={setBrightness}
              min={-100}
              max={100}
              invalid={percentInvalid(brightness)}
            />
          </Field>
          <Field labelKey="tool.adjustColors.contrast">
            <NumberInput
              testId="adjustcolors-contrast"
              value={contrast}
              onChange={setContrast}
              min={-100}
              max={100}
              invalid={percentInvalid(contrast)}
            />
          </Field>
          <Field labelKey="tool.adjustColors.saturation">
            <NumberInput
              testId="adjustcolors-saturation"
              value={saturation}
              onChange={setSaturation}
              min={-100}
              max={100}
              invalid={percentInvalid(saturation)}
            />
          </Field>
          <Field labelKey="tool.adjustColors.gamma">
            <NumberInput
              testId="adjustcolors-gamma"
              value={gamma}
              onChange={setGamma}
              min={0.1}
              max={3}
              step={0.1}
              invalid={gammaInvalid}
            />
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <Hint keyName="tool.adjustColors.hint" stacked />
          </div>
        </>
      }
    />
  );
}
