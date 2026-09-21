import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { pickPdfs } from "../../app/rpc";
import { SaveAsBar } from "../../components/SaveAsBar";
import { usePdfJob } from "../usePdfJob";
import { Field, Hint, NumberInput, RadioGroup, TextInput } from "../organize/forms";
import { validateOptionalPageSpec } from "../pagespec";
import { ToolFrame } from "../ToolFrame";

type Position =
  | "bottom-center"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "top-right"
  | "top-left";
type Format = "n" | "prefix-n" | "n-of-total";

export function BatesScreen() {
  const [position, setPosition] = useState<Position>("bottom-center");
  const [format, setFormat] = useState<Format>("prefix-n");
  const [prefix, setPrefix] = useState("");
  const [startNumber, setStartNumber] = useState(1);
  const [fontSize, setFontSize] = useState(10);
  const [margin, setMargin] = useState(28);
  const [pages, setPages] = useState("");
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const startInvalid = !Number.isInteger(startNumber) || startNumber < 0;
  const fontSizeInvalid = !Number.isInteger(fontSize) || fontSize < 6 || fontSize > 72;
  const marginInvalid = !Number.isFinite(margin) || margin < 0 || margin > 144;

  const error =
    startInvalid
      ? "tool.bates.startInvalid"
      : fontSizeInvalid
        ? "tool.bates.pageSizeInvalid"
        : marginInvalid
          ? "tool.bates.marginInvalid"
          : validateOptionalPageSpec(pages);

  const job = usePdfJob(TOOL_IDS.bates, (fs) => {
    const input: Record<string, unknown> = {
      filePath: fs[0], position, format, prefix, startNumber, fontSize, margin,
    };
    if (pages.trim()) input.pages = pages;
    return input;
  });
  const { files, setFiles, reset, run } = job;

  const start = () =>
    void run((result) => {
      if (!("outputPath" in result)) throw new Error("Expected a file result");
      setOutputPath(result.outputPath as string);
      return "done";
    });

  const handleReset = () => {
    setOutputPath(null);
    reset();
  };

  const pick = async () => {
    const picked = await pickPdfs(false);
    if (picked.length === 0) return;
    setFiles([picked[0]]);
  };

  return (
    <ToolFrame
      toolId={TOOL_IDS.bates}
      job={job}
      ctaKey="tool.bates.cta"
      canRun={files.length >= 1}
      validationKey={error}
      onPick={() => void pick()}
      onRun={start}
      pickContent={
        <>
          <Field labelKey="tool.bates.position">
            <RadioGroup
              name="bates-position"
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
          <Field labelKey="tool.bates.format">
            <RadioGroup
              name="bates-format"
              value={format}
              onChange={(v) => setFormat(v as Format)}
              choices={[
                { value: "n", labelKey: "tool.bates.formatN" },
                { value: "prefix-n", labelKey: "tool.bates.formatPrefixN" },
                { value: "n-of-total", labelKey: "tool.bates.formatNOfTotal" },
              ]}
            />
          </Field>
          <Field labelKey="tool.bates.prefix" hintKey="tool.bates.prefixHint">
            <TextInput testId="bates-prefix" value={prefix} onChange={setPrefix} />
          </Field>
          <Field labelKey="tool.bates.startNumber">
            <NumberInput
              testId="bates-start"
              value={startNumber}
              onChange={setStartNumber}
              min={0}
              invalid={startInvalid}
            />
          </Field>
          <Field labelKey="tool.bates.pageSize">
            <NumberInput
              testId="bates-fontsize"
              value={fontSize}
              onChange={setFontSize}
              min={6}
              max={72}
              invalid={fontSizeInvalid}
            />
          </Field>
          <Field labelKey="tool.bates.margin" hintKey="tool.bates.marginHint">
            <NumberInput
              testId="bates-margin"
              value={margin}
              onChange={setMargin}
              min={0}
              max={144}
              invalid={marginInvalid}
            />
          </Field>
          <Field labelKey="tool.bates.pages">
            <TextInput testId="bates-pages" value={pages} onChange={setPages} placeholder="1-3,5" />
          </Field>
          <Hint keyName="tool.bates.latinHint" stacked />
        </>
      }
      renderDone={() =>
        outputPath ? <SaveAsBar outputPath={outputPath} onReset={handleReset} /> : null
      }
    />
  );
}
