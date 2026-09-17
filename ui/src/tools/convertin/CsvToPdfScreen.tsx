import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { pickFiles } from "../../app/rpc";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, NumberInput, RadioGroup } from "../organize/forms";

type Orientation = "portrait" | "landscape";

export function CsvToPdfScreen() {
  const [fontSize, setFontSize] = useState(10);
  const [orientation, setOrientation] = useState<Orientation>("portrait");

  const fontSizeInvalid = !Number.isInteger(fontSize) || fontSize < 6 || fontSize > 72;

  return (
    <FileToolScreen
      toolId={TOOL_IDS.csvToPdf}
      acceptMultiple={false}
      ctaKey="tool.csvToPdf.cta"
      extensions={["csv"]}
      pick={() => pickFiles(false, "csv")}
      dropKeys={{ multiple: "tool.csvToPdf.drop", single: "tool.csvToPdf.dropSingle" }}
      validationError={() => (fontSizeInvalid ? "tool.csvToPdf.fontSizeInvalid" : null)}
      buildInput={(files) => ({ filePath: files[0], fontSize, orientation })}
      options={
        <>
          <Field labelKey="tool.csvToPdf.fontSize">
            <NumberInput
              testId="csvtopdf-fontsize"
              value={fontSize}
              onChange={setFontSize}
              min={6}
              max={72}
              invalid={fontSizeInvalid}
            />
          </Field>
          <Field labelKey="tool.csvToPdf.orientation">
            <RadioGroup
              name="csvtopdf-orientation"
              value={orientation}
              onChange={(v) => setOrientation(v as Orientation)}
              choices={[
                { value: "portrait", labelKey: "tool.csvToPdf.portrait" },
                { value: "landscape", labelKey: "tool.csvToPdf.landscape" },
              ]}
            />
          </Field>
          <Hint keyName="tool.csvToPdf.tableHint" stacked />
        </>
      }
    />
  );
}
