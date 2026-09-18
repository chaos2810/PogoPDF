import type { ReactNode } from "react";
import { pickPdfs } from "../../app/rpc";
import { usePdfJob } from "../usePdfJob";
import { ToolFrame } from "../ToolFrame";

export type DataToolScreenProps = {
  toolId: string;
  ctaKey: string;
  renderData: (data: unknown) => ReactNode;
  // File count the tool needs; defaults to 1 (single-file data tools).
  minFiles?: number;
  // Optional muted note under the drop zone (compare's similarity caveat).
  footnoteKey?: string;
  // Optional extra validation shown between the form and the CTA.
  validationError?: (files: string[]) => string | null;
};

// Data tools (viewMetadata, pageDimensions, comparePdfs) have no output file to
// save: the result IS the display. Runs once against the picked file(s), then
// renders renderData(result.data) in a card.
export function DataToolScreen({
  toolId,
  ctaKey,
  renderData,
  minFiles = 1,
  footnoteKey,
  validationError,
}: DataToolScreenProps) {
  const multiple = minFiles > 1;
  const job = usePdfJob(
    toolId,
    multiple ? (fs) => ({ filePaths: fs }) : (fs) => ({ filePath: fs[0] }),
    { multiple }
  );
  const { files, setFiles, run } = job;

  const runnable = files.length >= minFiles;
  const errorsKey = validationError ? validationError(files) : null;
  const showError = files.length > 0 ? errorsKey : null;

  const start = () =>
    void run((result) => {
      if (!("data" in result)) {
        throw new Error("Expected a data result");
      }
      job.setData(result.data);
      return "data";
    });

  const pick = async () => {
    const picked = await pickPdfs(multiple);
    if (picked.length === 0) return;
    setFiles((prev) =>
      multiple ? [...new Set([...prev, ...picked])] : [picked[0]]
    );
  };

  return (
    <ToolFrame
      toolId={toolId}
      job={job}
      ctaKey={ctaKey}
      canRun={runnable}
      blocked={Boolean(errorsKey)}
      validationKey={showError}
      acceptMultiple={multiple}
      onPick={() => void pick()}
      onRun={start}
      footnoteKey={footnoteKey}
      renderData={renderData}
    />
  );
}
