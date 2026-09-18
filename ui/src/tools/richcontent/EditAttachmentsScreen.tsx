import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { callEngine } from "../../app/rpc";
import { FileToolScreen } from "../FileToolScreen";
import { Hint } from "../organize/forms";

type Attachment = { id: number; name: string; size: number };

export function EditAttachmentsScreen() {
  const { lang } = useApp();
  const [loaded, setLoaded] = useState<Attachment[] | null>(null);
  // Rows are keyed by the list RPC's stable id, so duplicate names are distinct
  // rows instead of collapsing into one. The engine removes the FIRST match per
  // name, so buildInput sends each checked name once.
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async (filePath: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = (await callEngine("attachments.list", { filePath })) as {
        attachments: Attachment[];
      };
      setLoaded(result.attachments);
      setChecked(new Set());
    } catch (e) {
      setLoaded(null);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <FileToolScreen
      toolId={TOOL_IDS.editAttachments}
      acceptMultiple={false}
      ctaKey="tool.editAttachments.cta"
      buildInput={(files) => ({
        filePath: files[0],
        removeNames: [
          ...new Set(
            (loaded ?? []).filter((a) => checked.has(a.id)).map((a) => a.name)
          ),
        ],
      })}
      // The list must be loaded (and at least one file ticked) before removing.
      canRun={(files) => files.length >= 1 && loaded !== null && checked.size > 0}
      onFilesChange={() => {
        setLoaded(null);
        setChecked(new Set());
        setLoadError(null);
      }}
      options={({ files }) => (
        <div style={{ gridColumn: "1 / -1" }} data-testid="editAttachments-list">
          <button
            data-testid="editAttachments-load"
            disabled={files.length === 0 || loading}
            onClick={() => void load(files[0])}
            style={{
              padding: "8px 16px", borderRadius: "var(--radius-pill)", fontWeight: 600,
              background: "transparent", border: "1px solid var(--border)",
              color: files.length === 0 ? "var(--muted)" : "var(--text)",
              cursor: files.length === 0 || loading ? "not-allowed" : "pointer",
            }}
          >
            {loading
              ? t("tool.editAttachments.loading", lang)
              : t("tool.editAttachments.load", lang)}
          </button>

          {loadError && (
            <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>
              {loadError}
            </div>
          )}
          {loaded && loaded.length === 0 && (
            <div
              data-testid="editAttachments-empty"
              style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}
            >
              {t("tool.editAttachments.none", lang)}
            </div>
          )}
          {loaded && loaded.length > 0 && (
            <ul
              data-testid="data-rows"
              style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}
            >
              {loaded.map((a) => (
                <li
                  key={a.id}
                  data-testid="data-row"
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 0", borderBottom: "1px solid var(--border)",
                  }}
                >
                  <label
                    className="pogopdf-radio-choice"
                    style={{ margin: 0, flex: 1, minWidth: 0 }}
                  >
                    <input
                      type="checkbox"
                      data-testid={`editAttachments-check-${a.name}`}
                      checked={checked.has(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                    <span style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                      {a.name}
                    </span>
                  </label>
                  <span
                    style={{ color: "var(--muted)", fontSize: 12, flex: "0 0 84px", textAlign: "right" }}
                  >
                    {a.size} B
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Hint keyName="tool.editAttachments.listHint" stacked />
          <Hint keyName="tool.editAttachments.removeHint" stacked />
        </div>
      )}
    />
  );
}
