import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, NumberInput } from "../organize/forms";

export function RasterizeScreen() {
  const [dpi, setDpi] = useState(150);
  const dpiInvalid = !Number.isInteger(dpi) || dpi < 72 || dpi > 600;

  return (
    <FileToolScreen
      toolId={TOOL_IDS.rasterize}
      acceptMultiple={false}
      ctaKey="tool.rasterize.cta"
      validationError={() => (dpiInvalid ? "tool.rasterize.dpiInvalid" : null)}
      buildInput={(files) => ({ filePath: files[0], dpi })}
      options={
        <>
          <Field labelKey="tool.rasterize.dpi">
            <NumberInput
              testId="rasterize-dpi"
              value={dpi}
              onChange={setDpi}
              min={72}
              max={600}
              invalid={dpiInvalid}
            />
          </Field>
          <Hint keyName="tool.rasterize.rasterHint" stacked />
        </>
      }
    />
  );
}
