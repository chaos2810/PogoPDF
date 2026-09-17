import type { ReactNode } from "react";
import { useApp } from "../../app/store";
import { t } from "@pogopdf/i18n";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { pickPdfs } from "../../app/rpc";
import { FileQueueCards } from "../FileQueueCards";
import { usePdfJob } from "../usePdfJob";

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

  const cardStyle = {
    background: "var(--card)", borderRadius: "var(--radius-card)",
    padding: 20, boxShadow: "var(--shadow-card)",
  } as const;

  return (
    <main style={{ padding: 24, width: "100%", maxWidth: 720, margin: "0 auto" }}>
      <button
        onClick={() => navigate({ kind: "home" })}
        style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}
      >
        ← {t("common.back", lang)}
      </button>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: "8px 0" }}>{t(`tool.${toolId}.title`, lang)}</h1>

      {phase === "pick" && (
        <div style={cardStyle}>
          <button
            data-testid={`${toolId}-dropzone`}
            onClick={() => void pick()}
            style={{
              width: "100%", padding: "28px 12px", borderRadius: "var(--radius-tile)",
              border: isDragActive ? "2px solid var(--accent)" : "1.5px dashed var(--muted)",
              background: isDragActive ? "color-mix(in srgb, var(--accent) 12%, var(--bg))" : "var(--bg)",
              color: isDragActive ? "var(--accent)" : "var(--muted)",
              fontSize: 14, fontWeight: isDragActive ? 700 : 400, cursor: "pointer",
            }}
          >
            {t(
              isDragActive
                ? "tool.common.dropActive"
                : minFiles > 1
                  ? "tool.common.drop"
                  : "tool.common.dropSingle",
              lang
            )}
          </button>

          {footnoteKey && (
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
              {t(footnoteKey, lang)}
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <FileQueueCards
              toolId={toolId}
              files={minFiles > 1 ? files : singleFiles}
              onRemove={(path) =>
                setFiles((prev) =>
                  minFiles > 1 ? prev.filter((x) => x !== path) : []
                )
              }
            />
          </div>

          {minFiles > 1 && files.length > 0 && (
            <button
              onClick={() => void pick()}
              style={{
                marginTop: 12, marginRight: 10, padding: "10px 18px", borderRadius: "var(--radius-pill)",
                fontWeight: 600, background: "transparent", border: "1px solid var(--border)",
                color: "var(--text)", cursor: "pointer",
              }}
            >
              {t("tool.common.addMore", lang)}
            </button>
          )}

          {showError && (
            <div
              data-testid={`${toolId}-validation`}
              style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}
            >
              {t(showError, lang)}
            </div>
          )}

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
        <div style={cardStyle}>
          <div>{t("common.processing", lang)} {percent}%</div>
          <div style={{ height: 8, borderRadius: 999, background: "var(--border)", marginTop: 8 }}>
            <div style={{ width: `${percent}%`, height: "100%", borderRadius: 999, background: "var(--accent)", transition: "width 200ms" }} />
          </div>
          <button
            data-testid={`${toolId}-cancel`}
            onClick={() => void cancel()}
            style={{
              marginTop: 12, padding: "8px 16px", borderRadius: "var(--radius-pill)",
              fontWeight: 600, background: "transparent", border: "1px solid var(--border)",
              color: "var(--text)", cursor: "pointer",
            }}
          >
            {t("common.cancel", lang)}
          </button>
        </div>
      )}

      {phase === "data" && (
        <div style={cardStyle} data-testid={`${toolId}-data`}>
          {renderData(data)}
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
        <div data-testid={`${toolId}-error`} style={{ ...cardStyle, boxShadow: undefined }}>
          <div style={{ color: "var(--danger)", fontWeight: 700 }}>{t("common.error", lang)}</div>
          <div
            data-testid={`${toolId}-error-detail`}
            style={{
              marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 13,
              color: "var(--muted)", overflowWrap: "anywhere", wordBreak: "break-word",
            }}
          >
            {error}
          </div>
          {errorCode === TOOL_ERROR_CODES.INVALID_INPUT && (
            <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
              {t("common.checkInput", lang)}
            </div>
          )}
          <button
            onClick={() => setPhase("pick")}
            style={{
              display: "block", marginTop: 12, padding: "8px 14px",
              borderRadius: "var(--radius-pill)", fontWeight: 600,
              background: "transparent", border: "1px solid var(--danger)",
              color: "var(--danger)", cursor: "pointer",
            }}
          >
            {t("common.back", lang)}
          </button>
        </div>
      )}
    </main>
  );
}
