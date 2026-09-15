import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, NumberInput, RadioGroup, TextInput } from "./forms";
import { validatePageSpec } from "../pagespec";

type Mode = "ranges" | "every" | "single";

export function SplitScreen() {
  const [mode, setMode] = useState<Mode>("ranges");
  const [ranges, setRanges] = useState("");
  const [every, setEvery] = useState(2);
  const [prefix, setPrefix] = useState("");

  const modeError =
    mode === "ranges"
      ? validatePageSpec(ranges)
      : mode === "every"
        ? !Number.isInteger(every) || every < 1
          ? "tool.split.everyInvalid"
          : null
        : null;

  return (
    <FileToolScreen
      toolId={TOOL_IDS.split}
      acceptMultiple={false}
      ctaKey="tool.split.cta"
      multiOutput
      validationError={() => modeError}
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0], mode };
        if (mode === "ranges") input.ranges = ranges;
        if (mode === "every") input.every = every;
        if (prefix.trim()) input.filePrefix = prefix.trim();
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.split.mode">
            <RadioGroup
              name="split-mode"
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              choices={[
                { value: "ranges", labelKey: "tool.split.modeRanges" },
                { value: "every", labelKey: "tool.split.modeEvery" },
                { value: "single", labelKey: "tool.split.modeSingle" },
              ]}
            />
          </Field>
          {mode === "ranges" && (
            <Field labelKey="tool.split.ranges">
              <TextInput
                testId="split-ranges"
                value={ranges}
                onChange={setRanges}
                placeholder="1-3,5"
              />
            </Field>
          )}
          {mode === "every" && (
            <Field labelKey="tool.split.every">
              <NumberInput
                testId="split-every"
                value={every}
                onChange={setEvery}
                min={1}
                invalid={modeError === "tool.split.everyInvalid"}
              />
            </Field>
          )}
          <Field labelKey="tool.split.prefix">
            <TextInput testId="split-prefix" value={prefix} onChange={setPrefix} />
          </Field>
        </>
      }
    />
  );
}
