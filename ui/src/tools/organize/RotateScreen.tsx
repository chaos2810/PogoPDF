import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, RadioGroup, TextInput } from "./forms";
import { validateOptionalPageSpec } from "../pagespec";

type Angle = "90" | "180" | "270";

export function RotateScreen() {
  const [angle, setAngle] = useState<Angle>("90");
  const [pages, setPages] = useState("");
  return (
    <FileToolScreen
      toolId={TOOL_IDS.rotate}
      acceptMultiple={false}
      ctaKey="tool.rotate.cta"
      validationError={() => validateOptionalPageSpec(pages)}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0], angle: Number(angle) };
        if (pages.trim()) input.pages = pages;
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.rotate.angle">
            <RadioGroup
              name="rotate-angle"
              value={angle}
              onChange={(v) => setAngle(v as Angle)}
              choices={[
                { value: "90", labelKey: "tool.rotate.angle90" },
                { value: "180", labelKey: "tool.rotate.angle180" },
                { value: "270", labelKey: "tool.rotate.angle270" },
              ]}
            />
          </Field>
          <Field labelKey="tool.rotate.pages" hintKey="tool.rotate.pagesHint">
            <TextInput testId="rotate-pages" value={pages} onChange={setPages} placeholder="1-3,5" />
          </Field>
        </>
      }
    />
  );
}
