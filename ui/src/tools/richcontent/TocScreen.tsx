import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { useApp } from "../../app/store";
import { t } from "@pogopdf/i18n";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, RadioGroup, TextInput } from "../organize/forms";

type Position = "beginning" | "after-cover";

export function TocScreen() {
  const { lang } = useApp();
  const [position, setPosition] = useState<Position>("beginning");
  const [title, setTitle] = useState(t("tool.toc.defaultTitle", lang));

  return (
    <FileToolScreen
      toolId={TOOL_IDS.toc}
      acceptMultiple={false}
      ctaKey="tool.toc.cta"
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0], position };
        if (title.trim()) input.title = title;
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.toc.position">
            <RadioGroup
              name="toc-position"
              value={position}
              onChange={(v) => setPosition(v as Position)}
              choices={[
                { value: "beginning", labelKey: "tool.toc.beginning" },
                { value: "after-cover", labelKey: "tool.toc.afterCover" },
              ]}
            />
          </Field>
          <Field labelKey="tool.toc.titleField">
            <TextInput testId="toc-title" value={title} onChange={setTitle} />
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <Hint keyName="tool.toc.hint" stacked />
            <Hint keyName="tool.toc.latinHint" stacked />
          </div>
        </>
      }
    />
  );
}
