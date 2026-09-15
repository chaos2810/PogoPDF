import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, NumberInput, RadioGroup } from "./forms";

type Direction = "horizontal" | "vertical";

export function DividePagesScreen() {
  const [direction, setDirection] = useState<Direction>("vertical");
  const [count, setCount] = useState(2);
  const invalid = !Number.isInteger(count) || count < 2 || count > 10;
  return (
    <FileToolScreen
      toolId={TOOL_IDS.dividePages}
      acceptMultiple={false}
      ctaKey="tool.dividePages.cta"
      validationError={() => (invalid ? "tool.dividePages.countInvalid" : null)}
      buildInput={(files) => ({ filePath: files[0], direction, count })}
      options={
        <>
          <Field labelKey="tool.dividePages.direction">
            <RadioGroup
              name="divide-direction"
              value={direction}
              onChange={(v) => setDirection(v as Direction)}
              choices={[
                { value: "horizontal", labelKey: "tool.dividePages.horizontal" },
                { value: "vertical", labelKey: "tool.dividePages.vertical" },
              ]}
            />
          </Field>
          <Field labelKey="tool.dividePages.count">
            <NumberInput
              testId="divide-count"
              value={count}
              onChange={setCount}
              min={2}
              max={10}
              invalid={invalid}
            />
          </Field>
        </>
      }
    />
  );
}
