import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, NumberInput, TextInput } from "../organize/forms";
import { validateOptionalPageSpec } from "../pagespec";

const MAX_INSET = 500;

function invalid(v: number): boolean {
  return !Number.isFinite(v) || v < 0 || v > MAX_INSET;
}

export function CropScreen() {
  const [top, setTop] = useState(0);
  const [bottom, setBottom] = useState(0);
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  const [pages, setPages] = useState("");

  const anyInvalid = invalid(top) || invalid(bottom) || invalid(left) || invalid(right);
  const allZero = top === 0 && bottom === 0 && left === 0 && right === 0;

  const error = anyInvalid
    ? "tool.crop.insetInvalid"
    : allZero
      ? "tool.crop.nothingToCrop"
      : validateOptionalPageSpec(pages);

  const inset = (
    labelKey: string,
    testId: string,
    value: number,
    onChange: (v: number) => void
  ) => (
    <Field labelKey={labelKey}>
      <NumberInput
        testId={testId}
        value={value}
        onChange={onChange}
        min={0}
        max={MAX_INSET}
        invalid={invalid(value)}
      />
    </Field>
  );

  return (
    <FileToolScreen
      toolId={TOOL_IDS.crop}
      acceptMultiple={false}
      ctaKey="tool.crop.cta"
      validationError={() => error}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0], top, bottom, left, right };
        if (pages.trim()) input.pages = pages;
        return input;
      }}
      options={
        <>
          {inset("tool.crop.top", "crop-top", top, setTop)}
          {inset("tool.crop.bottom", "crop-bottom", bottom, setBottom)}
          {inset("tool.crop.left", "crop-left", left, setLeft)}
          {inset("tool.crop.right", "crop-right", right, setRight)}
          <Field labelKey="tool.crop.pages">
            <TextInput testId="crop-pages" value={pages} onChange={setPages} placeholder="1-3,5" />
          </Field>
        </>
      }
    />
  );
}
