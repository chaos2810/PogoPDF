import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { pickPdfs } from "../../app/rpc";
import { SaveAsBar } from "../../components/SaveAsBar";
import { usePdfJob } from "../usePdfJob";
import { Checkbox, Hint } from "../organize/forms";
import { ToolFrame } from "../ToolFrame";

type Flags = {
  removeMetadata: boolean;
  removeAnnotations: boolean;
  removeAttachments: boolean;
  removeJavaScript: boolean;
  flattenForms: boolean;
};

// All five flags default on, matching the engine schema.
const DEFAULT_FLAGS: Flags = {
  removeMetadata: true,
  removeAnnotations: true,
  removeAttachments: true,
  removeJavaScript: true,
  flattenForms: true,
};

const FLAG_KEY: Record<keyof Flags, string> = {
  removeMetadata: "tool.sanitize.removeMetadata",
  removeAnnotations: "tool.sanitize.removeAnnotations",
  removeAttachments: "tool.sanitize.removeAttachments",
  removeJavaScript: "tool.sanitize.removeJavaScript",
  flattenForms: "tool.sanitize.flattenForms",
};

export function SanitizeScreen() {
  const [flags, setFlags] = useState<Flags>({ ...DEFAULT_FLAGS });
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const job = usePdfJob(TOOL_IDS.sanitize, (fs) => ({ filePath: fs[0], ...flags }));
  const { files, setFiles, reset, run } = job;

  const start = () =>
    void run((result) => {
      if (!("outputPath" in result)) throw new Error("Expected a file result");
      setOutputPath(result.outputPath as string);
      return "done";
    });

  const handleReset = () => {
    setOutputPath(null);
    setFlags({ ...DEFAULT_FLAGS });
    reset();
  };

  const pick = async () => {
    const picked = await pickPdfs(false);
    if (picked.length === 0) return;
    setFiles([picked[0]]);
  };

  return (
    <ToolFrame
      toolId={TOOL_IDS.sanitize}
      job={job}
      ctaKey="tool.sanitize.cta"
      canRun={files.length >= 1}
      onPick={() => void pick()}
      onRun={start}
      pickContent={
        <div data-testid="sanitize-flags" style={{ marginTop: 6 }}>
          {(Object.keys(FLAG_KEY) as (keyof Flags)[]).map((key) => (
            <Checkbox
              key={key}
              testId={`sanitize-${key}`}
              checked={flags[key]}
              onChange={(v) => setFlags((prev) => ({ ...prev, [key]: v }))}
              labelKey={FLAG_KEY[key]}
            />
          ))}
          <Hint keyName="tool.sanitize.emptyHint" stacked />
          <Hint keyName="tool.sanitize.javascriptNote" stacked />
          <Hint keyName="tool.sanitize.flattenNote" stacked />
        </div>
      }
      renderDone={() =>
        outputPath ? <SaveAsBar outputPath={outputPath} onReset={handleReset} /> : null
      }
    />
  );
}
