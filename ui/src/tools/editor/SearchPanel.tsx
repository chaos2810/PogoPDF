import { Search, X } from "lucide-react";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";

export type SearchMatch = { page: number; snippet: string; x: number; y: number };

export function SearchPanel({
  query,
  onQuery,
  onSearch,
  onPick,
  onClose,
  matches,
  busy,
  error,
}: {
  query: string;
  onQuery: (q: string) => void;
  onSearch: () => void;
  onPick: (m: SearchMatch) => void;
  onClose: () => void;
  matches: SearchMatch[] | null;
  busy: boolean;
  error: string | null;
}) {
  const { lang } = useApp();
  return (
    <aside
      data-testid="editor-search-panel"
      style={{
        width: 280, flexShrink: 0, display: "flex", flexDirection: "column",
        borderLeft: "1px solid var(--border)", background: "var(--card)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 10 }}>
        <input
          data-testid="editor-search-input"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSearch();
          }}
          placeholder={t("tool.editor.searchPlaceholder", lang)}
          style={{
            flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--bg)",
            color: "var(--text)", fontSize: 13,
          }}
        />
        <button
          data-testid="editor-search-run"
          onClick={onSearch}
          disabled={busy || query.trim().length === 0}
          aria-label={t("tool.editor.searchRun", lang)}
          title={t("tool.editor.searchRun", lang)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, padding: 0, borderRadius: 8,
            border: "1px solid var(--border)",
            background: busy || query.trim().length === 0 ? "var(--border)" : "var(--accent)",
            color: busy || query.trim().length === 0 ? "var(--muted)" : "var(--accent-contrast)",
            cursor: busy ? "default" : "pointer",
          }}
        >
          <Search size={15} />
        </button>
        <button
          data-testid="editor-search-close"
          onClick={onClose}
          aria-label={t("tool.editor.searchClose", lang)}
          title={t("tool.editor.searchClose", lang)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, padding: 0, borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--bg)",
            color: "var(--text)", cursor: "pointer",
          }}
        >
          <X size={15} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 10px 10px" }}>
        {busy && (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "6px 4px" }}>
            {t("tool.editor.searchBusy", lang)}
          </div>
        )}
        {!busy && error && (
          <div style={{ color: "var(--danger)", fontSize: 13, padding: "6px 4px" }}>{error}</div>
        )}
        {!busy && !error && matches && matches.length === 0 && (
          <div data-testid="editor-search-empty" style={{ color: "var(--muted)", fontSize: 13, padding: "6px 4px" }}>
            {t("tool.editor.searchNoResults", lang)}
          </div>
        )}
        {!busy && matches && matches.length > 0 && (
          <ul data-testid="editor-search-results" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {matches.map((m, i) => (
              <li key={`${m.page}-${i}`}>
                <button
                  data-testid="editor-search-result"
                  data-page={m.page}
                  onClick={() => onPick(m)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "7px 8px", borderRadius: 8, border: "none",
                    background: "transparent", color: "var(--text)",
                    fontSize: 13, cursor: "pointer",
                  }}
                >
                  <span style={{ color: "var(--accent)", fontWeight: 700, marginRight: 6 }}>
                    {t("tool.editor.searchPage", lang, { page: String(m.page) })}
                  </span>
                  {m.snippet}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
