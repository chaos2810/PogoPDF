import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { FileToolScreen } from "../FileToolScreen";
import { Field, Hint, Select } from "../organize/forms";

// The "b" level is what Ghostscript emits for every part; the version selects
// the PDF/A part number only. Values are technical identifiers, not prose.
const VERSIONS = [
  { value: "1b", labelKey: "tool.pdfToPdfA.version1b" },
  { value: "2b", labelKey: "tool.pdfToPdfA.version2b" },
  { value: "3b", labelKey: "tool.pdfToPdfA.version3b" },
];

export function PdfToPdfAScreen() {
  const { lang } = useApp();
  const [version, setVersion] = useState("2b");

  return (
    <FileToolScreen
      toolId={TOOL_IDS.pdfToPdfA}
      acceptMultiple={false}
      ctaKey="tool.pdfToPdfA.cta"
      buildInput={(files) => ({ filePath: files[0], pdfaVersion: version })}
      options={
        <>
          <Field labelKey="tool.pdfToPdfA.version">
            <Select
              testId="pdftopdfa-version"
              value={version}
              onChange={setVersion}
              options={VERSIONS.map((v) => ({ value: v.value, label: t(v.labelKey, lang) }))}
            />
          </Field>
          <Hint keyName="tool.pdfToPdfA.hint" stacked />
        </>
      }
    />
  );
}
