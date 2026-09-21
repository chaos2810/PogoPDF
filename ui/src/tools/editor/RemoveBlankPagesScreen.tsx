import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { pickPdfs } from "../../app/rpc";
import { SaveAsBar } from "../../components/SaveAsBar";
import { usePdfJob } from "../usePdfJob";
import { Hint } from "../organize/forms";
import { ToolFrame } from "../ToolFrame";

export function RemoveBlankPagesScreen() {
  const { lang } = useApp();
  // Default 5 matches the engine schema default; the hint warns it can drop
  // sparse pages, so the slider is the user's control over that tradeoff.
  const [tolerance, setTolerance] = useState(5);
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const job = usePdfJob(TOOL_IDS.removeBlankPages, (fs) => ({
    filePath: fs[0],
    tolerance,
  }));
  const { files, setFiles, reset, run } = job;

  const start = () =>
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
      toolId={TOOL_IDS.removeBlankPages}
      job={job}
      ctaKey="tool.removeBlankPages.cta"
      canRun={files.length >= 1}
      onPick={() => void pick()}
      onRun={start}
      pickContent={
        <>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block" }}>
              <span style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                <span>{t("tool.removeBlankPages.tolerance", lang)}</span>
                <span data-testid="removeblankpages-value">{tolerance}%</span>
              </span>
              <input
                type="range"
                data-testid="removeblankpages-tolerance"
                min={0}
                max={100}
                step={1}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </label>
            <Hint keyName="tool.removeBlankPages.toleranceHint" />
          </div>
        </>
      }
      renderDone={() =>
        outputPath ? <SaveAsBar outputPath={outputPath} onReset={handleReset} /> : null
      }
    />
  );
}
