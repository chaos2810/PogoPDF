import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, RadioGroup } from "./forms";

type Direction = "vertical" | "horizontal";
type Align = "start" | "center" | "end";

export function CombineSinglePageScreen() {
  const [direction, setDirection] = useState<Direction>("vertical");
  const [align, setAlign] = useState<Align>("start");
  return (
    <FileToolScreen
      toolId={TOOL_IDS.combineSinglePage}
      acceptMultiple={false}
      ctaKey="tool.combineSinglePage.cta"
      buildInput={(files) => ({ filePath: files[0], direction, align })}
      options={
        <>
          <Field labelKey="tool.combineSinglePage.direction">
            <RadioGroup
              name="combine-direction"
              value={direction}
              onChange={(v) => setDirection(v as Direction)}
              choices={[
                { value: "vertical", labelKey: "tool.combineSinglePage.vertical" },
                { value: "horizontal", labelKey: "tool.combineSinglePage.horizontal" },
              ]}
            />
          </Field>
          <Field labelKey="tool.combineSinglePage.align">
            <RadioGroup
              name="combine-align"
              value={align}
              onChange={(v) => setAlign(v as Align)}
              choices={[
                { value: "start", labelKey: "tool.combineSinglePage.start" },
                { value: "center", labelKey: "tool.combineSinglePage.center" },
                { value: "end", labelKey: "tool.combineSinglePage.end" },
              ]}
            />
          </Field>
        </>
      }
    />
  );
}
