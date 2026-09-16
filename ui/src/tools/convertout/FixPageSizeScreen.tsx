import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, RadioGroup, Select } from "../organize/forms";

// Paper sizes are proper names, shown identically in every language.
const SIZES = [
  { value: "a4", label: "A4" },
  { value: "a3", label: "A3" },
  { value: "a5", label: "A5" },
  { value: "letter", label: "Letter" },
];

type Orientation = "portrait" | "landscape";
type Fit = "scale" | "pad";

export function FixPageSizeScreen() {
  const [size, setSize] = useState("a4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [fit, setFit] = useState<Fit>("scale");
  return (
    <FileToolScreen
      toolId={TOOL_IDS.fixPageSize}
      acceptMultiple={false}
      ctaKey="tool.fixPageSize.cta"
      buildInput={(files) => ({ filePath: files[0], size, orientation, fit })}
      options={
        <>
          <Field labelKey="tool.fixPageSize.size">
            <Select
              testId="fixpagesize-size"
              value={size}
              onChange={setSize}
              options={SIZES}
            />
          </Field>
          <Field labelKey="tool.fixPageSize.orientation">
            <RadioGroup
              name="fixpagesize-orientation"
              value={orientation}
              onChange={(v) => setOrientation(v as Orientation)}
              choices={[
                { value: "portrait", labelKey: "tool.fixPageSize.portrait" },
                { value: "landscape", labelKey: "tool.fixPageSize.landscape" },
              ]}
            />
          </Field>
          <Field labelKey="tool.fixPageSize.fit">
            <RadioGroup
              name="fixpagesize-fit"
              value={fit}
              onChange={(v) => setFit(v as Fit)}
              choices={[
                { value: "scale", labelKey: "tool.fixPageSize.fitScale" },
                { value: "pad", labelKey: "tool.fixPageSize.fitPad" },
              ]}
            />
          </Field>
          <Hint keyName={fit === "scale" ? "tool.fixPageSize.scaleHint" : "tool.fixPageSize.padHint"} />
        </>
      }
    />
  );
}
