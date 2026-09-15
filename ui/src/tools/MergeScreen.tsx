import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TOOL_IDS } from "@pogopdf/contracts";
import { useApp } from "../app/store";
import { t } from "@pogopdf/i18n";
import { startJob, onProgress, pickPdfs } from "../app/rpc";
import { SaveAsBar } from "../components/SaveAsBar";
import { basename } from "./paths";

type Phase = "pick" | "running" | "done" | "error";

export function MergeScreen() {
  const { lang, navigate } = useApp();
  const [files, setFiles] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string>("");
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  useEffect(() => onProgress((p) => setPercent(p.percent)), []);

  useEffect(() => {
    const win = getCurrentWindow();
    const isPdf = (p: string) => p.toLowerCase().endsWith(".pdf");
    const addFiles = (paths: string[]) => {
      const pdfs = paths.filter(isPdf);
      if (pdfs.length > 0) setFiles((prev) => [...new Set([...prev, ...pdfs])]);
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
  }, []);

  const canRun = files.length >= 2;

  const run = async () => {
    if (!canRun) return;
    setPhase("running");
    setPercent(0);
    try {
      const result = await startJob(TOOL_IDS.merge, { filePaths: files });
      setOutputPath(result.outputPath);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  return (
    <main style={{ padding: 24, width: "100%", maxWidth: 720, margin: "0 auto" }}>
      <button
        onClick={() => navigate({ kind: "home" })}
        style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}
      >
        ← {t("common.back", lang)}
      </button>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: "8px 0" }}>{t("tool.merge.title", lang)}</h1>

      {phase === "pick" && (
        <div style={{
          background: "var(--card)", borderRadius: "var(--radius-card)",
          padding: 20, boxShadow: "var(--shadow-card)",
        }}>
          <button
            data-testid="merge-dropzone"
            onClick={async () => {
              const picked = await pickPdfs(true);
              setFiles((prev) => [...new Set([...prev, ...picked])]);
            }}
            style={{
              width: "100%", padding: "28px 12px", borderRadius: "var(--radius-tile)",
              border: isDragActive ? "2px solid var(--accent)" : "2px dashed var(--border)",
              background: isDragActive ? "color-mix(in srgb, var(--accent) 12%, var(--bg))" : "var(--bg)",
              color: isDragActive ? "var(--accent)" : "var(--muted)",
              fontSize: 14, fontWeight: isDragActive ? 700 : 400, cursor: "pointer",
            }}
          >
            {t(isDragActive ? "tool.merge.dropActive" : "tool.merge.drop", lang)}
          </button>

          <div style={{ minHeight: files.length > 0 ? 180 : 0, marginTop: 12 }}>
            {files.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {files.map((f, i) => (
                  <li
                    key={f}
                    data-testid="merge-file-row"
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 8px",
                      borderBottom: i < files.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <span
                      data-testid="merge-file-name"
                      title={f}
                      style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere", wordBreak: "break-word" }}
                    >
                      {basename(f)}
                    </span>
                    <button
                      data-testid="merge-file-remove"
                      onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                      aria-label={t("tool.merge.remove", lang)}
                      title={t("tool.merge.remove", lang)}
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

          {files.length > 0 && (
            <button
              onClick={async () => {
                const picked = await pickPdfs(true);
                setFiles((prev) => [...new Set([...prev, ...picked])]);
              }}
              style={{
                marginTop: 12, marginRight: 10, padding: "10px 18px", borderRadius: "var(--radius-pill)",
                fontWeight: 600, background: "transparent", border: "1px solid var(--border)",
                color: "var(--text)", cursor: "pointer",
              }}
            >
              {t("tool.merge.addMore", lang)}
            </button>
          )}
          <button
            disabled={!canRun}
            onClick={() => void run()}
            style={{
              marginTop: 12, padding: "10px 22px", borderRadius: "var(--radius-pill)",
              fontWeight: 700, border: "none", cursor: canRun ? "pointer" : "not-allowed",
              background: canRun ? "var(--accent)" : "var(--border)",
              color: canRun ? "var(--accent-contrast)" : "var(--muted)",
            }}
          >
            {t("tool.merge.cta", lang)}
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

      {phase === "done" && outputPath && (
        <div style={{
          background: "var(--card)", borderRadius: "var(--radius-card)",
          padding: 20, boxShadow: "var(--shadow-card)",
        }}>
          <div style={{ fontWeight: 700 }}>{t("common.done", lang)}</div>
          <SaveAsBar outputPath={outputPath} onReset={() => { setFiles([]); setPhase("pick"); }} />
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
