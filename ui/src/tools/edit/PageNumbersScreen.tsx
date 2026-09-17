import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Checkbox, Field, NumberInput, RadioGroup, TextInput } from "../organize/forms";
import { validateOptionalPageSpec } from "../pagespec";

type Position =
  | "bottom-center"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "top-right"
  | "top-left";
type Format = "n" | "n-of-total" | "page-n";

export function PageNumbersScreen() {
  const [position, setPosition] = useState<Position>("bottom-center");
  const [format, setFormat] = useState<Format>("n");
  const [startNumber, setStartNumber] = useState(1);
  const [fontSize, setFontSize] = useState(10);
  const [margin, setMargin] = useState(28);
  const [pages, setPages] = useState("");
  const [skipFirst, setSkipFirst] = useState(false);

  const startInvalid = !Number.isInteger(startNumber) || startNumber < 1;
  const fontSizeInvalid = !Number.isInteger(fontSize) || fontSize < 6 || fontSize > 72;
  const marginInvalid = !Number.isFinite(margin) || margin < 0 || margin > 144;

  const error =
    startInvalid
      ? "tool.pageNumbers.startInvalid"
      : fontSizeInvalid
        ? "tool.pageNumbers.fontSizeInvalid"
        : marginInvalid
          ? "tool.pageNumbers.marginInvalid"
          : validateOptionalPageSpec(pages);

  return (
    <FileToolScreen
      toolId={TOOL_IDS.pageNumbers}
      acceptMultiple={false}
      ctaKey="tool.pageNumbers.cta"
      validationError={() => error}
      buildInput={(files) => {
        const input: Record<string, unknown> = {
          filePath: files[0],
          position,
          format,
          startNumber,
          fontSize,
          margin,
          skipFirst,
        };
        if (pages.trim()) input.pages = pages;
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.pageNumbers.position">
            <RadioGroup
              name="pagenumbers-position"
              value={position}
              onChange={(v) => setPosition(v as Position)}
              choices={[
                { value: "bottom-center", labelKey: "tool.pageNumbers.bottomCenter" },
                { value: "bottom-left", labelKey: "tool.pageNumbers.bottomLeft" },
                { value: "bottom-right", labelKey: "tool.pageNumbers.bottomRight" },
                { value: "top-center", labelKey: "tool.pageNumbers.topCenter" },
                { value: "top-left", labelKey: "tool.pageNumbers.topLeft" },
                { value: "top-right", labelKey: "tool.pageNumbers.topRight" },
              ]}
            />
          </Field>
          <Field labelKey="tool.pageNumbers.format">
            <RadioGroup
              name="pagenumbers-format"
              value={format}
              onChange={(v) => setFormat(v as Format)}
              choices={[
                { value: "n", labelKey: "tool.pageNumbers.formatN" },
                { value: "n-of-total", labelKey: "tool.pageNumbers.formatNOfTotal" },
                { value: "page-n", labelKey: "tool.pageNumbers.formatPageN" },
              ]}
            />
          </Field>
          <Field labelKey="tool.pageNumbers.startNumber">
            <NumberInput
              testId="pagenumbers-start"
              value={startNumber}
              onChange={setStartNumber}
              min={1}
              invalid={startInvalid}
            />
          </Field>
          <Field labelKey="tool.pageNumbers.fontSize">
            <NumberInput
              testId="pagenumbers-fontsize"
              value={fontSize}
              onChange={setFontSize}
              min={6}
              max={72}
              invalid={fontSizeInvalid}
            />
          </Field>
          <Field labelKey="tool.pageNumbers.margin" hintKey="tool.pageNumbers.marginHint">
            <NumberInput
              testId="pagenumbers-margin"
              value={margin}
              onChange={setMargin}
              min={0}
              max={144}
              invalid={marginInvalid}
            />
          </Field>
          <Field labelKey="tool.pageNumbers.pages">
            <TextInput
              testId="pagenumbers-pages"
              value={pages}
              onChange={setPages}
              placeholder="1-3,5"
            />
          </Field>
          <Checkbox
            testId="pagenumbers-skipfirst"
            checked={skipFirst}
            onChange={setSkipFirst}
            labelKey="tool.pageNumbers.skipFirst"
          />
        </>
      }
    />
  );
}
