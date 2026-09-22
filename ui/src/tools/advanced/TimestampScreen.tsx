import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, TextInput } from "../organize/forms";

function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function TimestampScreen() {
  const [tsaUrl, setTsaUrl] = useState("");

  const urlInvalid = !isUrl(tsaUrl);

  return (
    <FileToolScreen
      toolId={TOOL_IDS.timestamp}
      acceptMultiple={false}
      ctaKey="tool.timestamp.cta"
      validationError={() => (urlInvalid ? "tool.timestamp.tsaUrlInvalid" : null)}
      buildInput={(files) => ({ filePath: files[0], tsaUrl })}
      options={
        <>
          <Field labelKey="tool.timestamp.tsaUrl" hintKey="tool.timestamp.tsaUrlHint">
            <TextInput
              testId="timestamp-url"
              value={tsaUrl}
              onChange={setTsaUrl}
              placeholder="https://tsa.example.com"
              style={{ borderColor: urlInvalid ? "var(--danger)" : "var(--border)" }}
            />
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <Hint keyName="tool.timestamp.networkHint" stacked />
          </div>
        </>
      }
    />
  );
}
