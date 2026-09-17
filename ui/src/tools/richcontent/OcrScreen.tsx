import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { FileToolScreen } from "../FileToolScreen";
import { Checkbox, Field, Hint, NumberInput, Select, TextInput } from "../organize/forms";
import { validateOptionalPageSpec } from "../pagespec";

// Native language labels; the stored value is the tesseract language id.
const LANGUAGES = [
  { value: "eng", labelKey: "tool.ocr.langEng" },
  { value: "chi_tra", labelKey: "tool.ocr.langChiTra" },
  { value: "chi_sim", labelKey: "tool.ocr.langChiSim" },
  { value: "jpn", labelKey: "tool.ocr.langJpn" },
  { value: "kor", labelKey: "tool.ocr.langKor" },
  { value: "deu", labelKey: "tool.ocr.langDeu" },
  { value: "fra", labelKey: "tool.ocr.langFra" },
  { value: "spa", labelKey: "tool.ocr.langSpa" },
];

export function OcrScreen() {
  const { lang } = useApp();
  const [language, setLanguage] = useState("eng");
  const [dpi, setDpi] = useState(150);
  const [pages, setPages] = useState("");
  const [searchableOutput, setSearchableOutput] = useState(true);

  const dpiInvalid = !Number.isInteger(dpi) || dpi < 72 || dpi > 600;
  const error = dpiInvalid ? "tool.ocr.dpiInvalid" : validateOptionalPageSpec(pages);

  return (
    <FileToolScreen
      toolId={TOOL_IDS.ocr}
      acceptMultiple={false}
      ctaKey="tool.ocr.cta"
      validationError={() => error}
      buildInput={(files) => {
        const input: Record<string, unknown> = {
          filePath: files[0],
          language,
          dpi,
          searchableOutput,
        };
        if (pages.trim()) input.pages = pages;
        return input;
      }}
      progressWarningKey={(last) =>
        last?.stage === "ocr.droppedLines" && last.pagesDone > 0
          ? "tool.ocr.droppedWarning"
          : null
      }
      options={
        <>
          <Field labelKey="tool.ocr.language">
            <Select
              testId="ocr-language"
              value={language}
              onChange={setLanguage}
              options={LANGUAGES.map((l) => ({ value: l.value, label: t(l.labelKey, lang) }))}
            />
          </Field>
          <Field labelKey="tool.ocr.dpi">
            <NumberInput
              testId="ocr-dpi"
              value={dpi}
              onChange={setDpi}
              min={72}
              max={600}
              invalid={dpiInvalid}
            />
          </Field>
          <Field labelKey="tool.ocr.pages">
            <TextInput testId="ocr-pages" value={pages} onChange={setPages} placeholder="1-3,5" />
          </Field>
          <Hint keyName="tool.ocr.pagesHint" />
          <Checkbox
            testId="ocr-searchable"
            checked={searchableOutput}
            onChange={setSearchableOutput}
            labelKey="tool.ocr.searchable"
          />
          <Hint keyName="tool.ocr.searchableHint" />
          <div style={{ gridColumn: "1 / -1" }}>
            <Hint keyName="tool.ocr.latinHint" stacked />
          </div>
        </>
      }
    />
  );
}
