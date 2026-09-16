import { useEffect, useState } from "react";
import { useApp } from "../app/store";
import { registry } from "../tools/registry";
import { t } from "@pogopdf/i18n";

export function CommandPalette() {
  const { navigate, lang } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  const matches = registry.filter((tool) =>
    t(tool.titleKey, lang).toLowerCase().includes(query.toLowerCase())
  );

  const go = (toolId: string) => {
    setOpen(false);
    navigate({ kind: "tool", toolId });
  };

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.35)",
        display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 96,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, background: "var(--card)", borderRadius: "var(--radius-card)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)", padding: 12,
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches.length > 0) go(matches[0].id);
          }}
          placeholder={t("palette.placeholder", lang)}
          style={{
            width: "100%", padding: "8px 10px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--bg)",
            color: "var(--text)", fontSize: 14,
          }}
        />
        <div style={{ marginTop: 8, maxHeight: "calc(100vh - 260px)", overflowY: "auto" }}>
          {matches.map((tool) => (
            <button
              key={tool.id}
              onClick={() => go(tool.id)}
              style={{
                display: "flex", justifyContent: "space-between", width: "100%",
                padding: "8px 10px", borderRadius: 8, border: "none",
                background: "transparent", color: "var(--text)",
                fontSize: 14, cursor: "pointer",
              }}
            >
              <span>{t(tool.titleKey, lang)}</span>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>
                {t(tool.category === "utility" ? "nav.all" : `nav.${tool.category}`, lang)}
              </span>
            </button>
          ))}
        </div>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
          {t("palette.hint", lang)}
        </div>
      </div>
    </div>
  );
}
