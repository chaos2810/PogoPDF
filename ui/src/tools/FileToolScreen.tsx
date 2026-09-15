import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../app/store";
import { t } from "@pogopdf/i18n";
import { startJob, callEngine, onProgress, pickPdfs } from "../app/rpc";
import { SaveAsBar } from "../components/SaveAsBar";
import { MultiFileResultSchema } from "@pogopdf/contracts";
import { basename } from "./paths";

// Multi-output job result parse lives here (not rpc.ts) until Task 9 adds the
// shared multi-file RPC + Save-All flow.
async function startJobMulti(toolId: string, input: unknown) {
  const jobId = crypto.randomUUID();
  const result = await callEngine("job.start", { jobId, toolId, input });
  return MultiFileResultSchema.parse(result);
}

type Phase = "pick" | "running" | "done" | "error";

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
  // Set for tools whose engine result is {outputPaths} (split); Save As for
  // multiple outputs lands with Task 9.
  multiOutput?: boolean;
  ctaIdSuffix?: string;
};

export function FileToolScreen({
  toolId,
  acceptMultiple,
  ctaKey,
  buildInput,
  validationError,
  options,
  canRun,
  multiOutput = false,
  ctaIdSuffix = "cta",
}: FileToolScreenProps) {
  const { lang, navigate } = useApp();
  const [files, setFiles] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string>("");
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [producedCount, setProducedCount] = useState(0);
  const [isDragActive, setIsDragActive] = useState(false);

  useEffect(() => onProgress((p) => setPercent(p.percent)), []);

  useEffect(() => {
    const win = getCurrentWindow();
    const isPdf = (p: string) => p.toLowerCase().endsWith(".pdf");
    const addFiles = (paths: string[]) => {
      const pdfs = paths.filter(isPdf);
      if (pdfs.length === 0) return;
      setFiles((prev) =>
        acceptMultiple ? [...new Set([...prev, ...pdfs])] : [pdfs[0]]
      );
    };
    const unEnter = win.listen<{ paths: string[] }>("tauri://drag-enter", (e) => {
      if (e.payload.paths.some(isPdf)) setIsDragActive(true);
    });
    const unOver = win.listen("tauri://drag-over", () => setIsDragActive(true));
    const unLeave = win.listen("tauri://drag-leave", () => setIsDragActive(false));
    const unDrop = win.listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
      setIsDragActive(false);
      addFiles(e.payload.paths);
    });
    return () => {
      void unEnter.then((f) => f());
      void unOver.then((f) => f());
      void unLeave.then((f) => f());
      void unDrop.then((f) => f());
    };
  }, [acceptMultiple]);

  const errorsKey = validationError ? validationError(files) : null;
  // Don't flag options before the user has added a file — an untouched form
  // should not already show a validation error.
  const showError = files.length > 0 ? errorsKey : null;
  const runnable =
    (canRun ? canRun(files) : acceptMultiple ? files.length >= 2 : files.length >= 1) &&
    !errorsKey;

  const reset = () => {
    setFiles([]);
    setPhase("pick");
    setOutputPath(null);
  };

  const run = async () => {
    if (!runnable) return;
    setPhase("running");
    setPercent(0);
    try {
      if (multiOutput) {
        const result = await startJobMulti(toolId, buildInput(files));
        setProducedCount(result.outputPaths.length);
      } else {
        const result = await startJob(toolId, buildInput(files));
        setOutputPath(result.outputPath);
      }
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
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
              border: isDragActive ? "2px solid var(--accent)" : "2px dashed var(--border)",
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

          <div style={{ minHeight: files.length > 0 ? 180 : 0, marginTop: 12 }}>
            {files.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {files.map((f, i) => (
                  <li
                    key={f}
                    data-testid={`${toolId}-file-row`}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 8px",
                      borderBottom: i < files.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <span
                      data-testid={`${toolId}-file-name`}
                      title={f}
                      style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere", wordBreak: "break-word" }}
                    >
                      {basename(f)}
                    </span>
                    <button
                      data-testid={`${toolId}-file-remove`}
                      onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                      aria-label={t("tool.common.remove", lang)}
                      title={t("tool.common.remove", lang)}
                      style={{
                        flexShrink: 0, border: "none", background: "none",
                        color: "var(--danger)", cursor: "pointer", fontSize: 14,
                        padding: "4px 6px", lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
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

          {options && <div style={{ marginTop: 16 }}>{options}</div>}

          {showError && (
            <div data-testid={`${toolId}-validation`} style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>
              {t(showError, lang)}
            </div>
          )}

          <button
            data-testid={`${toolId}-${ctaIdSuffix}`}
            disabled={!runnable}
            onClick={() => void run()}
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
        </div>
      )}

      {phase === "done" && multiOutput && (
        <div style={{
          background: "var(--card)", borderRadius: "var(--radius-card)",
          padding: 20, boxShadow: "var(--shadow-card)",
        }}>
          <div style={{ fontWeight: 700 }}>{t("common.done", lang)}</div>
          <div data-testid={`${toolId}-produced`} style={{ color: "var(--muted)", marginTop: 8 }}>
            {t("tool.common.producedN", lang, { count: String(producedCount) })}
          </div>
          <button
            onClick={reset}
            style={{
              marginTop: 16, padding: "8px 14px", borderRadius: "var(--radius-pill)", fontWeight: 600,
              background: "transparent", border: "1px solid var(--border)", color: "var(--text)",
              cursor: "pointer",
            }}
          >
            {t("common.back", lang)}
          </button>
        </div>
      )}

      {phase === "done" && !multiOutput && outputPath && (
        <div style={{
          background: "var(--card)", borderRadius: "var(--radius-card)",
          padding: 20, boxShadow: "var(--shadow-card)",
        }}>
          <div style={{ fontWeight: 700 }}>{t("common.done", lang)}</div>
          <SaveAsBar outputPath={outputPath} onReset={reset} />
        </div>
      )}

      {phase === "error" && (
        <div style={{
          background: "var(--card)", borderRadius: "var(--radius-card)",
          padding: 20, color: "var(--danger)",
        }}>
          {t("common.error", lang)}: {error}
          <button onClick={() => setPhase("pick")} style={{ display: "block", marginTop: 8, cursor: "pointer" }}>
            {t("common.back", lang)}
          </button>
        </div>
      )}
    </main>
  );
}
