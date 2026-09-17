import { useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../app/store";
import { t } from "@pogopdf/i18n";
import { pickPdfs } from "../app/rpc";
import { SaveAsBar } from "../components/SaveAsBar";
import { usePdfJob } from "./usePdfJob";
import {
  CARD_STYLE,
  DropZone,
  ErrorCard,
  Footnote,
  Queue,
  RunningCard,
  ToolHeader,
  ValidationMessage,
} from "./SharedToolParts";

export type FileToolScreenProps = {
  toolId: string;
  acceptMultiple: boolean;
  ctaKey: string;
  buildInput: (files: string[]) => unknown;
  // Returns an i18n key to show/hide inline, or null when the input is usable.
  validationError?: (files: string[]) => string | null;
  options?: ReactNode;
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
};

export function FileToolScreen({
  toolId,
  acceptMultiple,
  ctaKey,
  buildInput,
  validationError,
  options,
  canRun,
  extensions,
  pick: pickOverride,
  footnoteKey,
  dropKeys,
}: FileToolScreenProps) {
  const { lang, navigate } = useApp();
  const {
    files,
    setFiles,
    phase,
    setPhase,
    percent,
    error,
    errorCode,
    isDragActive,
    reset,
    cancel,
    run,
  } = usePdfJob(toolId, buildInput, { multiple: acceptMultiple, extensions });
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [outputPaths, setOutputPaths] = useState<string[] | null>(null);

  const errorsKey = validationError ? validationError(files) : null;
  // Don't flag options before the user has added a file — an untouched form
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

  return (
    <main style={{ padding: 24, width: "100%", maxWidth: 720, margin: "0 auto" }}>
      <ToolHeader toolId={toolId} onBack={() => navigate({ kind: "home" })} />

      {phase === "pick" && (
        <div style={CARD_STYLE}>
          <DropZone
            toolId={toolId}
            isDragActive={isDragActive}
            multiple={acceptMultiple}
            onClick={() => void pick()}
            dropKeys={dropKeys}
          />

          <Footnote footnoteKey={footnoteKey} />

          <Queue
            toolId={toolId}
            files={files}
            onRemove={(path) => setFiles((prev) => prev.filter((x) => x !== path))}
            onAddMore={acceptMultiple ? () => void pick() : undefined}
          />

          {options && (
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
              {options}
            </div>
          )}

          <ValidationMessage toolId={toolId} errorKey={showError} />

          <button
            data-testid={`${toolId}-cta`}
            disabled={!runnable}
            onClick={start}
            style={{
              marginTop: 12, padding: "10px 22px", borderRadius: "var(--radius-pill)",
              fontWeight: 700, border: "none", cursor: runnable ? "pointer" : "not-allowed",
              background: runnable ? "var(--accent)" : "var(--border)",
              color: runnable ? "var(--accent-contrast)" : "var(--muted)",
            }}
          >
            {t(ctaKey, lang)}
          </button>
        </div>
      )}

      {phase === "running" && (
        <RunningCard toolId={toolId} percent={percent} onCancel={() => void cancel()} />
      )}

      {phase === "done" && outputPaths && (
        <div style={CARD_STYLE}>
          <div style={{ fontWeight: 700 }}>{t("common.done", lang)}</div>
          <SaveAsBar outputPaths={outputPaths} onReset={handleReset} />
        </div>
      )}

      {phase === "done" && outputPath && (
        <div style={CARD_STYLE}>
          <div style={{ fontWeight: 700 }}>{t("common.done", lang)}</div>
          <SaveAsBar outputPath={outputPath} onReset={handleReset} />
        </div>
      )}

      {phase === "error" && (
        <ErrorCard
          toolId={toolId}
          error={error}
          errorCode={errorCode}
          onBack={() => setPhase("pick")}
        />
      )}
    </main>
  );
}
