import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { pickPdfs } from "../../app/rpc";
import { SaveAsBar } from "../../components/SaveAsBar";
import { usePdfJob } from "../usePdfJob";
import { Field, Hint, NumberInput, Select, TextInput } from "../organize/forms";
import { ToolFrame } from "../ToolFrame";

type Style =
  | "decimal"
  | "roman-upper"
  | "roman-lower"
  | "letters-upper"
  | "letters-lower"
  | "none";

export function PageLabelsScreen() {
  const { lang } = useApp();
  const [style, setStyle] = useState<Style>("decimal");
  const [start, setStart] = useState(1);
  const [prefix, setPrefix] = useState("");
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const startInvalid = !Number.isInteger(start) || start < 1;
  const error = startInvalid ? "tool.pageLabels.startInvalid" : null;

  const job = usePdfJob(TOOL_IDS.pageLabels, (fs) => ({
    filePath: fs[0], style, start, prefix,
  }));
  const { files, setFiles, reset, run } = job;

  const startJob = () =>
    void run((result) => {
      if (!("outputPath" in result)) throw new Error("Expected a file result");
      setOutputPath(result.outputPath as string);
      return "done";
    });

  const handleReset = () => {
    setOutputPath(null);
    reset();
  };

  const pick = async () => {
    const picked = await pickPdfs(false);
    if (picked.length === 0) return;
    setFiles([picked[0]]);
  };

  return (
    <ToolFrame
      toolId={TOOL_IDS.pageLabels}
      job={job}
      ctaKey="tool.pageLabels.cta"
      canRun={files.length >= 1 && !error}
      validationKey={files.length > 0 ? error : null}
      onPick={() => void pick()}
      onRun={startJob}
      pickContent={
        <>
          <Field labelKey="tool.pageLabels.style">
            <Select
              testId="pagelabels-style"
              value={style}
              onChange={(v) => setStyle(v as Style)}
              options={[
                { value: "decimal", label: t("tool.pageLabels.styleDecimal", lang) },
                { value: "roman-upper", label: t("tool.pageLabels.styleRomanUpper", lang) },
                { value: "roman-lower", label: t("tool.pageLabels.styleRomanLower", lang) },
                { value: "letters-upper", label: t("tool.pageLabels.styleLettersUpper", lang) },
                { value: "letters-lower", label: t("tool.pageLabels.styleLettersLower", lang) },
                { value: "none", label: t("tool.pageLabels.styleNone", lang) },
              ]}
            />
          </Field>
          <Field labelKey="tool.pageLabels.start">
            <NumberInput
              testId="pagelabels-start"
              value={start}
              onChange={setStart}
              min={1}
              invalid={startInvalid}
            />
          </Field>
          <Field labelKey="tool.pageLabels.prefix" hintKey="tool.pageLabels.prefixHint">
            <TextInput testId="pagelabels-prefix" value={prefix} onChange={setPrefix} />
          </Field>
          <Hint keyName="tool.pageLabels.hint" stacked />
        </>
      }
      renderDone={() =>
        outputPath ? <SaveAsBar outputPath={outputPath} onReset={handleReset} /> : null
      }
    />
  );
}
