import { useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../app/store";
import { t } from "@pogopdf/i18n";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { pickPdfs } from "../app/rpc";
import { SaveAsBar } from "../components/SaveAsBar";
import { FileQueueCards } from "./FileQueueCards";
import { usePdfJob } from "./usePdfJob";

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
};

export function FileToolScreen({
  toolId,
  acceptMultiple,
  ctaKey,
  buildInput,
  validationError,
  options,
  canRun,
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
  } = usePdfJob(toolId, buildInput, { multiple: acceptMultiple });
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
    const picked = await pickPdfs(acceptMultiple);
    if (picked.length === 0) return;
    setFiles((prev) =>
      acceptMultiple ? [...new Set([...prev, ...picked])] : [picked[0]]
    );
  };

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
        <div style={{
          background: "var(--card)", borderRadius: "var(--radius-card)",
          padding: 20, boxShadow: "var(--shadow-card)",
        }}>
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
                : acceptMultiple
                  ? "tool.common.drop"
                  : "tool.common.dropSingle",
              lang
            )}
          </button>

          <div style={{ marginTop: 12 }}>
            <FileQueueCards
              toolId={toolId}
              files={files}
              onRemove={(path) => setFiles((prev) => prev.filter((x) => x !== path))}
            />
          </div>

          {acceptMultiple && files.length > 0 && (
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

          {showError && (
            <div data-testid={`${toolId}-validation`} style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>
              {t(showError, lang)}
            </div>
          )}

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
        <div style={{
          background: "var(--card)", borderRadius: "var(--radius-card)",
          padding: 20, boxShadow: "var(--shadow-card)",
        }}>
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

      {phase === "done" && outputPaths && (
        <div style={{
          background: "var(--card)", borderRadius: "var(--radius-card)",
          padding: 20, boxShadow: "var(--shadow-card)",
        }}>
          <div style={{ fontWeight: 700 }}>{t("common.done", lang)}</div>
          <SaveAsBar outputPaths={outputPaths} onReset={handleReset} />
        </div>
      )}

      {phase === "done" && outputPath && (
        <div style={{
          background: "var(--card)", borderRadius: "var(--radius-card)",
          padding: 20, boxShadow: "var(--shadow-card)",
        }}>
          <div style={{ fontWeight: 700 }}>{t("common.done", lang)}</div>
          <SaveAsBar outputPath={outputPath} onReset={handleReset} />
        </div>
      )}

      {phase === "error" && (
        <div
          data-testid={`${toolId}-error`}
          style={{
            background: "var(--card)", borderRadius: "var(--radius-card)",
            padding: 20,
          }}
        >
          <div style={{ color: "var(--danger)", fontWeight: 700 }}>
            {t("common.error", lang)}
          </div>
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
