import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { pickFiles } from "../../app/rpc";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, PasswordInput, TextInput } from "../organize/forms";
import { basename } from "../paths";

// The PDF arrives through the standard drop zone; the certificate is a second,
// non-PDF pick (.p12/.pfx). The passphrase is a password input, so it is never
// shown in the clear and transits the RPC boundary like protect's passwords.
export function SignCertScreen() {
  const { lang } = useApp();
  const [p12Path, setP12Path] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");

  const pickCert = async () => {
    const picked = await pickFiles(false, "p12,pfx");
    if (picked.length > 0) setP12Path(picked[0]);
  };

  return (
    <FileToolScreen
      toolId={TOOL_IDS.digitalSign}
      acceptMultiple={false}
      ctaKey="tool.digitalSign.cta"
      validationError={() => (p12Path.length === 0 ? "tool.digitalSign.p12Required" : null)}
      buildInput={(files) => {
        const input: Record<string, unknown> = {
          filePath: files[0],
          p12Path,
          passphrase,
        };
        if (name.trim()) input.name = name;
        if (reason.trim()) input.reason = reason;
        if (location.trim()) input.location = location;
        return input;
      }}
      options={
        <>
          <div style={{ gridColumn: "1 / -1" }} data-testid="signcert-p12">
            <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {t("tool.digitalSign.p12", lang)}
            </span>
            <button
              data-testid="signcert-pick"
              onClick={() => void pickCert()}
              style={{
                padding: "8px 14px", borderRadius: "var(--radius-pill)", fontWeight: 600,
                background: "transparent", border: "1px solid var(--border)",
                color: "var(--text)", cursor: "pointer",
                maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {p12Path ? basename(p12Path) : t("tool.digitalSign.p12Pick", lang)}
            </button>
          </div>
          <Field labelKey="tool.digitalSign.passphrase" hintKey="tool.digitalSign.passphraseHint">
            <PasswordInput testId="signcert-passphrase" value={passphrase} onChange={setPassphrase} />
          </Field>
          <Field labelKey="tool.digitalSign.name">
            <TextInput testId="signcert-name" value={name} onChange={setName} />
          </Field>
          <Field labelKey="tool.digitalSign.reason">
            <TextInput testId="signcert-reason" value={reason} onChange={setReason} />
          </Field>
          <Field labelKey="tool.digitalSign.location">
            <TextInput testId="signcert-location" value={location} onChange={setLocation} />
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <Hint keyName="tool.digitalSign.hint" stacked />
          </div>
        </>
      }
    />
  );
}
