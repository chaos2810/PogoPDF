import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, NumberInput } from "./forms";

export function RotateCustomScreen() {
  const [angle, setAngle] = useState(45);
  const invalid = !Number.isFinite(angle) || angle < -360 || angle > 360 || angle === 0;
  return (
    <FileToolScreen
      toolId={TOOL_IDS.rotateCustom}
      acceptMultiple={false}
      ctaKey="tool.rotateCustom.cta"
      validationError={() => (invalid ? "tool.rotateCustom.angleInvalid" : null)}
      buildInput={(files) => ({ filePath: files[0], angle })}
      options={
        <Field labelKey="tool.rotateCustom.angle">
          <NumberInput
            testId="rotatecustom-angle"
            value={angle}
            onChange={setAngle}
            min={-360}
            max={360}
            invalid={invalid}
          />
        </Field>
      }
    />
  );
}
