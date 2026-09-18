import type { ReactNode } from "react";
import { t } from "@pogopdf/i18n";
import { useApp } from "../app/store";
import type { usePdfJob } from "./usePdfJob";
import {
  CARD_STYLE,
  DropZone,
  ErrorCard,
  Footnote,
  JobWarning,
  Queue,
  RunningCard,
  ToolHeader,
  ValidationMessage,
} from "./SharedToolParts";

export type PdfJob = ReturnType<typeof usePdfJob>;

export type ToolFrameProps = {
  toolId: string;
  // The usePdfJob state machine the screen created for its tool.
  job: PdfJob;
  ctaKey: string;
  // Raw run gate (file count / rows valid). Controls the CTA's hover cursor.
  canRun: boolean;
  // A validation failure that blocks the run without being part of the gate.
  // Keeps the CTA hover state DataToolScreen had before the extraction.
  blocked?: boolean;
  validationKey?: string | null;
  acceptMultiple?: boolean;
  // Opens the file picker; reused by the drop zone and the "Add more" button.
  onPick: () => void;
  // Starts the job (each screen passes its own settle function to job.run).
  onRun: () => void;
  dropKeys?: { multiple: string; single: string };
  footnoteKey?: string;
  // Pick-phase content between the queue and the CTA (options form or editor).
  pickContent?: ReactNode;
  // Non-fatal banner shown on the done card (OCR's dropped searchable lines).
  warningKey?: string | null;
  // Content under the done heading; null hides the done card (no output yet).
  renderDone?: () => ReactNode | null;
  // When set, the data phase renders this card instead of a done card.
  renderData?: (data: unknown) => ReactNode;
};

/**
 * The pick -> run -> settle shell shared by every tool screen. Owns the header,
 * drop zone, queue, options slot, CTA, running card, done/data card, and error
 * card. Screens supply only their pick content, run handler, and settle view.
 */
export function ToolFrame({
  toolId,
  job,
  ctaKey,
  canRun,
  blocked,
  validationKey,
  acceptMultiple = false,
  onPick,
  onRun,
  dropKeys,
  footnoteKey,
  pickContent,
  warningKey,
  renderDone,
  renderData,
}: ToolFrameProps) {
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
    isDragActive,
    reset,
    cancel,
  } = job;

  const ctaEnabled = canRun && !blocked;
  const doneContent = phase === "done" && renderDone ? renderDone() : null;

  return (
    <main style={{ padding: 24, width: "100%", maxWidth: 720, margin: "0 auto" }}>
      <ToolHeader toolId={toolId} onBack={() => navigate({ kind: "home" })} />

      {phase === "pick" && (
        <div style={CARD_STYLE}>
          <DropZone
            toolId={toolId}
            isDragActive={isDragActive}
            multiple={acceptMultiple}
            onClick={onPick}
            dropKeys={dropKeys}
          />

          <Footnote footnoteKey={footnoteKey} />

          <Queue
            toolId={toolId}
            files={acceptMultiple ? files : files.slice(0, 1)}
            onRemove={(path) =>
              setFiles((prev) =>
                acceptMultiple ? prev.filter((x) => x !== path) : []
              )
            }
            onAddMore={acceptMultiple ? onPick : undefined}
          />

          {pickContent}

          <ValidationMessage toolId={toolId} errorKey={validationKey ?? null} />

          <button
            data-testid={`${toolId}-cta`}
            disabled={!ctaEnabled}
            onClick={onRun}
            style={{
              marginTop: 12, padding: "10px 22px", borderRadius: "var(--radius-pill)",
              fontWeight: 700, border: "none", cursor: canRun ? "pointer" : "not-allowed",
              background: ctaEnabled ? "var(--accent)" : "var(--border)",
              color: ctaEnabled ? "var(--accent-contrast)" : "var(--muted)",
            }}
          >
            {t(ctaKey, lang)}
          </button>
        </div>
      )}

      {phase === "running" && (
        <RunningCard toolId={toolId} percent={percent} onCancel={() => void cancel()} />
      )}

      {doneContent && (
        <div style={CARD_STYLE}>
          <div style={{ fontWeight: 700 }}>{t("common.done", lang)}</div>
          {warningKey && <JobWarning toolId={toolId} warningKey={warningKey} />}
          {doneContent}
        </div>
      )}

      {phase === "data" && renderData && (
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
