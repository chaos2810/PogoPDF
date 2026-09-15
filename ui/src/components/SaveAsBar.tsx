import { useState } from "react";
import { callEngine, saveAsPdf, revealInExplorer } from "../app/rpc";
import { t } from "@pogopdf/i18n";
import { useApp } from "../app/store";

export function SaveAsBar({ outputPath, onReset }: { outputPath: string; onReset: () => void }) {
  const { lang } = useApp();
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      const dest = await saveAsPdf("merged.pdf");
      if (!dest) return;
      await callEngine("file.copy", { src: outputPath, dest });
      setSavedTo(dest);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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
          <span style={{ color: "var(--muted)" }}>{t("common.done", lang)} · {savedTo}</span>
          <button
            onClick={() => void revealInExplorer(savedTo)}
            title={savedTo}
            style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}
          >
            ↗
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
