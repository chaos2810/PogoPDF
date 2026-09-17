import type { ReactNode } from "react";
import { useApp } from "../../app/store";
import { t } from "@pogopdf/i18n";
import { pickPdfs } from "../../app/rpc";
import { usePdfJob } from "../usePdfJob";
import {
  CARD_STYLE,
  DropZone,
  ErrorCard,
  Footnote,
  Queue,
  RunningCard,
  ToolHeader,
  ValidationMessage,
} from "../SharedToolParts";

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
  const { lang, navigate } = useApp();
  const {
    files,
    setFiles,
    phase,
    setPhase,
    percent,
    error,
    errorCode,
    data,
    setData,
    isDragActive,
    reset,
    cancel,
    run,
  } = usePdfJob(
    toolId,
    minFiles > 1 ? (fs) => ({ filePaths: fs }) : (fs) => ({ filePath: fs[0] }),
    { multiple: minFiles > 1 }
  );

  const runnable = files.length >= minFiles;
  const errorsKey = validationError ? validationError(files) : null;
  const showError = files.length > 0 ? errorsKey : null;

  const start = () =>
    void run((result) => {
      if (!("data" in result)) {
        throw new Error("Expected a data result");
      }
      setData(result.data);
      return "data";
    });

  const pick = async () => {
    const picked = await pickPdfs(minFiles > 1);
    if (picked.length === 0) return;
    setFiles((prev) =>
      minFiles > 1 ? [...new Set([...prev, ...picked])] : [picked[0]]
    );
  };

  const singleFiles = files.length > 0 ? [files[0]] : [];

  return (
    <main style={{ padding: 24, width: "100%", maxWidth: 720, margin: "0 auto" }}>
      <ToolHeader toolId={toolId} onBack={() => navigate({ kind: "home" })} />

      {phase === "pick" && (
        <div style={CARD_STYLE}>
          <DropZone
            toolId={toolId}
            isDragActive={isDragActive}
            multiple={minFiles > 1}
            onClick={() => void pick()}
          />

          <Footnote footnoteKey={footnoteKey} />

          <Queue
            toolId={toolId}
            files={minFiles > 1 ? files : singleFiles}
            onRemove={(path) =>
              setFiles((prev) =>
                minFiles > 1 ? prev.filter((x) => x !== path) : []
              )
            }
            onAddMore={minFiles > 1 ? () => void pick() : undefined}
          />

          <ValidationMessage toolId={toolId} errorKey={showError} />

          <button
            data-testid={`${toolId}-cta`}
            disabled={!runnable || Boolean(errorsKey)}
            onClick={start}
            style={{
              marginTop: 12, padding: "10px 22px", borderRadius: "var(--radius-pill)",
              fontWeight: 700, border: "none", cursor: runnable ? "pointer" : "not-allowed",
              background: runnable && !errorsKey ? "var(--accent)" : "var(--border)",
              color: runnable && !errorsKey ? "var(--accent-contrast)" : "var(--muted)",
            }}
          >
            {t(ctaKey, lang)}
          </button>
        </div>
      )}

      {phase === "running" && (
        <RunningCard toolId={toolId} percent={percent} onCancel={() => void cancel()} />
      )}

      {phase === "data" && (
        <div style={CARD_STYLE} data-testid={`${toolId}-data`}>
          {renderData(data)}
          <Footnote footnoteKey={footnoteKey} testId={`${toolId}-footnote`} />
          <button
            data-testid={`${toolId}-back`}
            onClick={reset}
            style={{
              display: "block", marginTop: 16, padding: "8px 16px",
              borderRadius: "var(--radius-pill)", fontWeight: 600,
              background: "transparent", border: "1px solid var(--border)",
              color: "var(--text)", cursor: "pointer",
            }}
          >
            {t("common.back", lang)}
          </button>
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
