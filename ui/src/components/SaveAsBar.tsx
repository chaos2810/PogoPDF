import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { callEngine, pickFolder, saveAsPdf, revealInExplorer } from "../app/rpc";
import { t } from "@pogopdf/i18n";
import { useApp } from "../app/store";
import { basename, joinPath } from "../tools/paths";

type Props = {
  // Single-file mode (merge, organize, â€¦).
  outputPath?: string;
  // Multi-file mode (split): one "Save All" copies every output to a folder.
  outputPaths?: string[];
  onReset: () => void;
};

type RowStatus = "pending" | "copying" | "done" | "error";

const iconSlot: React.CSSProperties = {
  display: "inline-flex",
  width: 16,
  height: 16,
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
};

export function SaveAsBar({ outputPath, outputPaths, onReset }: Props) {
  const { lang } = useApp();

  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<{ src: string; status: RowStatus; error?: string }[] | null>(null);

  const save = async () => {
    if (!outputPath) return;
    setError(null);
    try {
      const dest = await saveAsPdf(basename(outputPath));
      if (!dest) return;
      await callEngine("file.copy", { src: outputPath, dest });
      setSavedTo(dest);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyInto = async (targets: string[], destDir: string) => {
    setBusy(true);
    setRows((prev) =>
      (prev ?? targets.map((src) => ({ src, status: "pending" as RowStatus }))).map((r) =>
        targets.includes(r.src) ? { ...r, status: "copying" } : r
      )
    );
    for (const src of targets) {
      setRows((prev) =>
        prev ? prev.map((r) => (r.src === src ? { ...r, status: "copying" } : r)) : prev
      );
      try {
        await callEngine("file.copy", { src, dest: joinPath(destDir, basename(src)) });
        setRows((prev) =>
          prev ? prev.map((r) => (r.src === src ? { ...r, status: "done" } : r)) : prev
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setRows((prev) =>
          prev
            ? prev.map((r) => (r.src === src ? { ...r, status: "error", error: message } : r))
            : prev
        );
      }
    }
    setBusy(false);
  };

  const saveAll = async () => {
    if (!outputPaths || outputPaths.length === 0) return;
    const dir = await pickFolder();
    if (!dir) return;
    setFolder(dir);
    setRows(outputPaths.map((src) => ({ src, status: "pending" })));
    await copyInto(outputPaths, dir);
  };

  const retryFailed = async () => {
    if (!folder || !rows) return;
    await copyInto(rows.filter((r) => r.status === "error").map((r) => r.src), folder);
  };

  if (outputPaths) {
    const failed = rows?.filter((r) => r.status === "error").length ?? 0;
    const allDone = rows !== null && !busy && failed === 0;
    return (
      <div style={{ marginTop: 16 }}>
        <div data-testid="split-produced" style={{ color: "var(--muted)", marginBottom: 12 }}>
          {t("tool.common.producedN", lang, { count: String(outputPaths.length) })}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            data-testid="save-all"
            disabled={busy || allDone}
            onClick={() => void saveAll()}
            style={{
              padding: "8px 18px", borderRadius: "var(--radius-pill)", fontWeight: 700,
              background: busy || allDone ? "var(--border)" : "var(--accent)",
              color: busy || allDone ? "var(--muted)" : "var(--accent-contrast)",
              border: "none", cursor: busy || allDone ? "default" : "pointer",
            }}
          >
            {t("tool.common.saveAll", lang)}
          </button>
          {allDone && (
            <>
              <span style={{ color: "var(--muted)" }}>{t("tool.common.saveAllDone", lang)}</span>
              <button
                onClick={() => folder && void revealInExplorer(folder)}
                title={folder ?? ""}
                aria-label={t("tool.common.openFolder", lang)}
                data-testid="save-all-reveal"
                style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}
              >
                â†-
              </button>
            </>
          )}
          {!busy && failed > 0 && (
            <>
              <span style={{ color: "var(--danger)", fontSize: 13 }}>
                {t("tool.common.copyFailed", lang, { count: String(failed) })}
              </span>
              <button
                data-testid="save-all-retry"
                onClick={() => void retryFailed()}
                style={{
                  padding: "8px 14px", borderRadius: "var(--radius-pill)", fontWeight: 600,
                  background: "transparent", border: "1px solid var(--border)", color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                {t("tool.common.retryFailed", lang)}
              </button>
            </>
          )}
          <button
            onClick={onReset}
            style={{
              padding: "8px 14px", borderRadius: "var(--radius-pill)", fontWeight: 600,
              background: "transparent", border: "1px solid var(--border)", color: "var(--text)",
              cursor: "pointer",
            }}
          >
            {t("common.back", lang)}
          </button>
        </div>

        {rows && (
          <ul data-testid="save-all-rows" style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
            {rows.map((r) => (
              <li
                key={r.src}
                data-testid="save-all-row"
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px" }}
              >
                <span style={iconSlot}>
                  {r.status === "copying" && (
                    <Loader2 size={16} className="animate-spin" color="var(--accent)" />
                  )}
                  {r.status === "done" && <Check size={16} color="var(--accent)" />}
                  {r.status === "error" && <X size={16} color="var(--danger)" />}
                </span>
                <span
                  title={r.status === "error" && r.error ? r.error : r.src}
                  style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere", wordBreak: "break-word" }}
                >
                  {basename(r.src)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
      <button
        onClick={() => void save()}
        style={{
          padding: "8px 18px", borderRadius: "var(--radius-pill)", fontWeight: 700,
          background: "var(--accent)", color: "var(--accent-contrast)", border: "none",
          cursor: "pointer",
        }}
      >
        {t("common.saveAs", lang)}
      </button>
      {savedTo && (
        <>
          <span style={{ color: "var(--muted)" }}>{t("common.done", lang)} Â· {savedTo}</span>
          <button
            onClick={() => void revealInExplorer(savedTo)}
            title={savedTo}
            style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}
          >
            â†-
          </button>
        </>
      )}
      {error && <span style={{ color: "var(--danger)" }}>{error}</span>}
      <button
        onClick={onReset}
        style={{
          padding: "8px 14px", borderRadius: "var(--radius-pill)", fontWeight: 600,
          background: "transparent", border: "1px solid var(--border)", color: "var(--text)",
          cursor: "pointer",
        }}
      >
        {t("common.back", lang)}
      </button>
    </div>
  );
}
