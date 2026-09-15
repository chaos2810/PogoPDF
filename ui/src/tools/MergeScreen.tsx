import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TOOL_IDS } from "@pogopdf/contracts";
import { useApp } from "../app/store";
import { t } from "@pogopdf/i18n";
import { startJob, onProgress, pickPdfs } from "../app/rpc";
import { SaveAsBar } from "../components/SaveAsBar";

type Phase = "pick" | "running" | "done" | "error";

export function MergeScreen() {
  const { lang, navigate } = useApp();
  const [files, setFiles] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string>("");
  const [outputPath, setOutputPath] = useState<string | null>(null);

  useEffect(() => onProgress((p) => setPercent(p.percent)), []);

  useEffect(() => {
    const un = getCurrentWindow().listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
      const pdfs = e.payload.paths.filter((p) => p.toLowerCase().endsWith(".pdf"));
      if (pdfs.length > 0) setFiles((prev) => [...new Set([...prev, ...pdfs])]);
    });
    return () => {
      void un.then((f) => f());
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
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
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
            onClick={async () => {
              const picked = await pickPdfs(true);
              setFiles((prev) => [...new Set([...prev, ...picked])]);
            }}
            style={{
              width: "100%", padding: "28px 12px", borderRadius: "var(--radius-tile)",
              border: `2px dashed var(--border)`, background: "var(--bg)",
              color: "var(--muted)", fontSize: 14, cursor: "pointer",
            }}
          >
            {t("tool.merge.drop", lang)}
          </button>
          {files.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
              {files.map((f) => (
                <li key={f} style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f}</span>
                  <button
                    onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                    style={{ border: "none", background: "none", color: "var(--danger)", cursor: "pointer" }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
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
