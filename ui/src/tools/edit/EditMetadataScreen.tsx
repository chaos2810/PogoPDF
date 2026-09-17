import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, TextInput } from "../organize/forms";

type FieldName = "title" | "author" | "subject" | "keywords" | "creator" | "producer";

const FIELDS: { name: FieldName; labelKey: string; testId: string }[] = [
  { name: "title", labelKey: "tool.editMetadata.fieldTitle", testId: "editmetadata-title" },
  { name: "author", labelKey: "tool.editMetadata.fieldAuthor", testId: "editmetadata-author" },
  { name: "subject", labelKey: "tool.editMetadata.fieldSubject", testId: "editmetadata-subject" },
  { name: "keywords", labelKey: "tool.editMetadata.fieldKeywords", testId: "editmetadata-keywords" },
  { name: "creator", labelKey: "tool.editMetadata.fieldCreator", testId: "editmetadata-creator" },
  { name: "producer", labelKey: "tool.editMetadata.fieldProducer", testId: "editmetadata-producer" },
];

type Values = Record<FieldName, string>;

const EMPTY: Values = {
  title: "",
  author: "",
  subject: "",
  keywords: "",
  creator: "",
  producer: "",
};

export function EditMetadataScreen() {
  const { lang } = useApp();
  const [values, setValues] = useState<Values>(EMPTY);
  const [cleared, setCleared] = useState<Record<FieldName, boolean>>({
    title: false,
    author: false,
    subject: false,
    keywords: false,
    creator: false,
    producer: false,
  });

  const setValue = (name: FieldName, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));
  const setClear = (name: FieldName, value: boolean) =>
    setCleared((prev) => ({ ...prev, [name]: value }));

  return (
    <FileToolScreen
      toolId={TOOL_IDS.editMetadata}
      acceptMultiple={false}
      ctaKey="tool.editMetadata.cta"
      buildInput={(files) => {
        const input: Record<string, unknown> = { filePath: files[0] };
        for (const { name } of FIELDS) {
          if (cleared[name]) {
            // null removes the field; absent leaves it unchanged.
            input[name] = null;
          } else if (values[name].trim()) {
            input[name] = values[name];
          }
        }
        return input;
      }}
      options={
        <>
          {FIELDS.map(({ name, labelKey, testId }) => (
            <div key={name}>
              <Field labelKey={labelKey}>
                <TextInput
                  testId={testId}
                  value={values[name]}
                  onChange={(v) => setValue(name, v)}
                />
              </Field>
              <label
                className="pogopdf-radio-choice"
                style={{ marginTop: -4, marginBottom: 8, fontSize: 12 }}
              >
                <input
                  type="checkbox"
                  data-testid={`${testId}-clear`}
                  checked={cleared[name]}
                  onChange={(e) => setClear(name, e.target.checked)}
                />
                {t("tool.editMetadata.clearField", lang)}
              </label>
            </div>
          ))}
          <Hint keyName="tool.editMetadata.blankHint" stacked />
        </>
      }
    />
  );
}
