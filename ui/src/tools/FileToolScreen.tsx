import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { t } from "@pogopdf/i18n";
import { pickPdfs, type ProgressPayload } from "../app/rpc";
import { SaveAsBar } from "../components/SaveAsBar";
import { usePdfJob } from "./usePdfJob";
import { ToolFrame } from "./ToolFrame";

export type FileToolScreenProps = {
  toolId: string;
  acceptMultiple: boolean;
  ctaKey: string;
  buildInput: (files: string[]) => unknown;
  // Returns an i18n key to show/hide inline, or null when the input is usable.
  validationError?: (files: string[]) => string | null;
  // Static form nodes, or a function of the current file list when the form
  // must react to the picked file (the attachment editor's Load list step).
  options?: ReactNode | ((ctx: { files: string[] }) => ReactNode);
  // Fired whenever the picked files change (the attachment editor resets its
  // loaded list when the primary PDF is replaced).
  onFilesChange?: (files: string[]) => void;
  // Defaults to "at least 2 files" (multiple) / "at least 1 file" (single).
  canRun?: (files: string[]) => boolean;
  // Extensions accepted by drag-drop; defaults to PDF-only.
  extensions?: string[];
  // Overrides the default PDF file dialog (imagesToPdf picks image files).
  pick?: () => Promise<string[]>;
  // Muted note under the drop zone, e.g. "Markdown renders simply".
  footnoteKey?: string;
  // Drop-zone wording override; defaults to the PDF phrasing.
  dropKeys?: { multiple: string; single: string };
  // Optional i18n key for a warning banner derived from the last progress
  // notification (OCR's dropped searchable lines). Renders on the done card.
  progressWarningKey?: (last: ProgressPayload | null) => string | null;
};

export function FileToolScreen({
  toolId,
  acceptMultiple,
  ctaKey,
  buildInput,
  validationError,
  options,
  onFilesChange,
  canRun,
  extensions,
  pick: pickOverride,
  footnoteKey,
  dropKeys,
  progressWarningKey,
}: FileToolScreenProps) {
  const job = usePdfJob(toolId, buildInput, {
    multiple: acceptMultiple,
    extensions,
  });
  const { files, setFiles, reset, warning, run } = job;
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [outputPaths, setOutputPaths] = useState<string[] | null>(null);

  const errorsKey = validationError ? validationError(files) : null;
  // Don't flag options before the user has added a file - an untouched form
  // should not already show a validation error.
  const showError = files.length > 0 ? errorsKey : null;
  const runnable =
    (canRun ? canRun(files) : acceptMultiple ? files.length >= 2 : files.length >= 1) &&
    !errorsKey;

  const start = () =>
    void run((result) => {
      if ("outputPaths" in result) {
        setOutputPaths(result.outputPaths as string[]);
        return "done";
      }
      if ("outputPath" in result) {
        setOutputPath(result.outputPath as string);
        return "done";
      }
      throw new Error("Expected a file result");
    });

  // The warning comes from the latch (usePdfJob), not the single latest
  // progress payload, so the engine's terminal done notification cannot hide it.
  const warningKey = progressWarningKey ? progressWarningKey(warning) : null;

  // Notify only when the file list actually changes, not on the initial mount
  // (the attachment editor clears its loaded list on a genuine replacement).
  const filesRef = useRef(files);
  useEffect(() => {
    if (filesRef.current !== files) {
      filesRef.current = files;
      onFilesChange?.(files);
    }
  }, [files, onFilesChange]);

  const optionsNode: ReactNode =
    typeof options === "function" ? options({ files }) : options;

  const clearOutputs = () => {
    setOutputPath(null);
    setOutputPaths(null);
  };

  const handleReset = () => {
    clearOutputs();
    reset();
  };

  const pick = async () => {
    const picked = pickOverride
      ? await pickOverride()
      : await pickPdfs(acceptMultiple);
    if (picked.length === 0) return;
    setFiles((prev) =>
      acceptMultiple ? [...new Set([...prev, ...picked])] : [picked[0]]
    );
  };

  const renderDone = () => {
    if (outputPaths) return <SaveAsBar outputPaths={outputPaths} onReset={handleReset} />;
    if (outputPath) return <SaveAsBar outputPath={outputPath} onReset={handleReset} />;
    return null;
  };

  return (
    <ToolFrame
      toolId={toolId}
      job={job}
      ctaKey={ctaKey}
      canRun={runnable}
      validationKey={showError}
      acceptMultiple={acceptMultiple}
      onPick={() => void pick()}
      onRun={start}
      dropKeys={dropKeys}
      footnoteKey={footnoteKey}
      pickContent={
        optionsNode ? (
          <div
            data-testid="options-form"
            // Two columns on wide cards so tall option forms stay inside the
            // viewport with the CTA; single column when narrow.
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              columnGap: 16,
            }}
          >
            {optionsNode}
          </div>
        ) : undefined
      }
      warningKey={warningKey}
      renderDone={renderDone}
    />
  );
}
