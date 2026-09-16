import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, NumberInput } from "../organize/forms";

export function PdfToCbzScreen() {
  const [dpi, setDpi] = useState(150);
  const dpiInvalid = !Number.isFinite(dpi) || dpi < 72 || dpi > 600;
  return (
    <FileToolScreen
      toolId={TOOL_IDS.pdfToCbz}
      acceptMultiple={false}
      ctaKey="tool.pdfToCbz.cta"
      validationError={() => (dpiInvalid ? "tool.pdfToCbz.dpiInvalid" : null)}
      buildInput={(files) => ({ filePath: files[0], dpi })}
      options={
        <Field labelKey="tool.pdfToCbz.dpi">
          <NumberInput
            testId="pdftocbz-dpi"
            value={dpi}
            onChange={setDpi}
            min={72}
            max={600}
            invalid={dpiInvalid}
          />
        </Field>
      }
    />
  );
}
