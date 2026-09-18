import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { TOOL_IDS } from "@pogopdf/contracts";
import type { BookmarkNode } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { pickPdfs, startJob } from "../../app/rpc";
import { usePdfJob } from "../usePdfJob";
import { SaveAsBar } from "../../components/SaveAsBar";
import { Hint } from "../organize/forms";
import { ToolFrame } from "../ToolFrame";

// The v1 editor is a flat list: saving replaces the outline with the rows shown.
// Nested bookmarks load flattened so nothing is hidden, and the hint says so.
type Row = { title: string; page: number };

function flatten(nodes: BookmarkNode[]): Row[] {
  return nodes.flatMap((node) => [{ title: node.title, page: node.page }, ...flatten(node.children)]);
}

export function EditBookmarksScreen() {
  const { lang } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  // buildInput runs at job start, so read the latest rows through a ref.
  const rowsRef = useRef<Row[]>(rows);
  rowsRef.current = rows;

  const job = usePdfJob(
    TOOL_IDS.editBookmarks,
    (fs) => ({
      filePath: fs[0],
      bookmarks: rowsRef.current
        .filter((r) => r.title.trim().length > 0 && Number.isInteger(r.page) && r.page >= 1)
        .map((r) => ({ title: r.title, page: r.page, children: [] })),
    })
  );
  const { files, setFiles, reset, run } = job;

  // Auto-load the outline whenever the picked PDF changes.
  useEffect(() => {
    const filePath = files[0];
    if (!filePath) {
      setRows([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const result = await startJob(TOOL_IDS.viewBookmarks, { filePath });
        if (!alive) return;
        const bookmarks = "data" in result ? (result.data as { bookmarks?: BookmarkNode[] }) : null;
        setRows(flatten(bookmarks?.bookmarks ?? []));
      } catch (e) {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [files]);

  const validRows = rows.filter(
    (r) => r.title.trim().length > 0 && Number.isInteger(r.page) && r.page >= 1
  );
  const rowsInvalid = rows.length > 0 && validRows.length !== rows.length;
  // The hint under the empty list already explains "add a row"; validation is
  // reserved for a row that is present but incomplete.
  const validationKey = rowsInvalid ? "tool.editBookmarks.rowInvalid" : null;

  const setRow = (index: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const removeRow = (index: number) =>
    setRows((prev) => prev.filter((_, i) => i !== index));
  const addRow = () => setRows((prev) => [...prev, { title: "", page: 1 }]);

  const start = () =>
    void run((result) => {
      if (!("outputPath" in result)) throw new Error("Expected a file result");
      setOutputPath(result.outputPath as string);
      return "done";
    });

  const handleReset = () => {
    setOutputPath(null);
    setRows([]);
    reset();
  };

  const pick = async () => {
    const picked = await pickPdfs(false);
    if (picked.length === 0) return;
    setFiles([picked[0]]);
  };

  // An empty list is runnable: it clears the outline (the engine deletes
  // /Outlines). A present-but-incomplete row is what blocks the CTA.
  const runnable = files.length >= 1 && validRows.length === rows.length;

  return (
    <ToolFrame
      toolId={TOOL_IDS.editBookmarks}
      job={job}
      ctaKey="tool.editBookmarks.cta"
      canRun={runnable}
      validationKey={validationKey}
      onPick={() => void pick()}
      onRun={start}
      pickContent={
        <>
          {files.length > 0 && loading && (
            <div data-testid="editBookmarks-loading" style={{ color: "var(--muted)", marginTop: 12 }}>
              {t("tool.editBookmarks.loading", lang)}
            </div>
          )}
          {loadError && (
            <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>{loadError}</div>
          )}

          {files.length > 0 && !loading && (
            <div data-testid="data-rows" style={{ marginTop: 12 }}>
              {rows.length === 0 && (
                <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 8 }}>
                  {t("tool.editBookmarks.noBookmarks", lang)}
                </div>
              )}
              {rows.map((row, i) => (
                <div
                  key={i}
                  data-testid="data-row"
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}
                >
                  <input
                    data-testid="editBookmarks-title"
                    value={row.title}
                    onChange={(e) => setRow(i, { title: e.target.value })}
                    aria-label={t("tool.editBookmarks.titleField", lang)}
                    style={{
                      flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8,
                      border: "1px solid var(--border)", background: "var(--bg)",
                      color: "var(--text)", fontSize: 14,
                    }}
                  />
                  <input
                    type="number"
                    min={1}
                    data-testid="editBookmarks-page"
                    value={Number.isFinite(row.page) ? row.page : ""}
                    onChange={(e) =>
                      setRow(i, { page: e.target.value === "" ? NaN : Number(e.target.value) })
                    }
                    aria-label={t("tool.editBookmarks.pageField", lang)}
                    style={{
                      width: 90, padding: "8px 10px", borderRadius: 8,
                      border: "1px solid var(--border)", background: "var(--bg)",
                      color: "var(--text)", fontSize: 14,
                    }}
                  />
                  <button
                    data-testid="editBookmarks-remove"
                    onClick={() => removeRow(i)}
                    aria-label={t("tool.editBookmarks.remove", lang)}
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      border: "none", background: "transparent", color: "var(--danger)",
                      cursor: "pointer", padding: 4,
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button
                data-testid="editBookmarks-add"
                onClick={addRow}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8,
                  padding: "8px 14px", borderRadius: "var(--radius-pill)", fontWeight: 600,
                  background: "transparent", border: "1px solid var(--border)",
                  color: "var(--text)", cursor: "pointer",
                }}
              >
                <Plus size={14} /> {t("tool.editBookmarks.addRow", lang)}
              </button>
              <Hint keyName="tool.editBookmarks.replaceHint" stacked />
              <Hint keyName="tool.editBookmarks.latinHint" stacked />
            </div>
          )}
        </>
      }
      renderDone={() =>
        outputPath ? <SaveAsBar outputPath={outputPath} onReset={handleReset} /> : null
      }
    />
  );
}
