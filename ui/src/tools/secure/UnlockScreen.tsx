import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, PasswordInput } from "../organize/forms";

export function UnlockScreen() {
  const [password, setPassword] = useState("");

  return (
    <FileToolScreen
      toolId={TOOL_IDS.unlock}
      acceptMultiple={false}
      ctaKey="tool.unlock.cta"
      buildInput={(files) => ({ filePath: files[0], password })}
      options={
        <>
          <Field labelKey="tool.unlock.password" hintKey="tool.unlock.passwordHint">
            <PasswordInput testId="unlock-password" value={password} onChange={setPassword} />
          </Field>
          <Hint keyName="tool.unlock.emptyHint" stacked />
        </>
      }
    />
  );
}
