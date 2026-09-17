import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Checkbox, Field, Hint, PasswordInput } from "../organize/forms";

export function ProtectScreen() {
  const [ownerPassword, setOwnerPassword] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [allowPrinting, setAllowPrinting] = useState(true);
  const [allowCopying, setAllowCopying] = useState(false);

  const error =
    ownerPassword.length === 0 ? "tool.protect.ownerRequired" : null;

  return (
    <FileToolScreen
      toolId={TOOL_IDS.protect}
      acceptMultiple={false}
      ctaKey="tool.protect.cta"
      validationError={() => error}
      buildInput={(files) => {
        const input: Record<string, unknown> = {
          filePath: files[0],
          ownerPassword,
          allowPrinting,
          allowCopying,
        };
        if (userPassword.length > 0) input.userPassword = userPassword;
        return input;
      }}
      options={
        <>
          <Field labelKey="tool.protect.ownerPassword" hintKey="tool.protect.ownerHint">
            <PasswordInput
              testId="protect-owner"
              value={ownerPassword}
              onChange={setOwnerPassword}
            />
          </Field>
          <Field labelKey="tool.protect.userPassword" hintKey="tool.protect.userHint">
            <PasswordInput
              testId="protect-user"
              value={userPassword}
              onChange={setUserPassword}
            />
          </Field>
          <Checkbox
            testId="protect-printing"
            checked={allowPrinting}
            onChange={setAllowPrinting}
            labelKey="tool.protect.allowPrinting"
          />
          <Checkbox
            testId="protect-copying"
            checked={allowCopying}
            onChange={setAllowCopying}
            labelKey="tool.protect.allowCopying"
          />
          <Hint keyName="tool.protect.lostHint" stacked />
        </>
      }
    />
  );
}
