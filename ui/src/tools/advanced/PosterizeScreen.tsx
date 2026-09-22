import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, NumberInput } from "../organize/forms";

export function PosterizeScreen() {
  const [levels, setLevels] = useState(4);
  const levelsInvalid = !Number.isInteger(levels) || levels < 2 || levels > 32;

  return (
    <FileToolScreen
      toolId={TOOL_IDS.posterize}
      acceptMultiple={false}
      ctaKey="tool.posterize.cta"
      validationError={() => (levelsInvalid ? "tool.posterize.levelsInvalid" : null)}
      buildInput={(files) => ({ filePath: files[0], levels })}
      options={
        <>
          <Field labelKey="tool.posterize.levels" hintKey="tool.posterize.levelsHint">
            <NumberInput
              testId="posterize-levels"
              value={levels}
              onChange={setLevels}
              min={2}
              max={32}
              invalid={levelsInvalid}
            />
          </Field>
        </>
      }
    />
  );
}
