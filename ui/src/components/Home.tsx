import { useState } from "react";
import { useApp } from "../app/store";
import { registry } from "../tools/registry";
import { t } from "@pogopdf/i18n";

export function Home() {
  const { navigate, lang, categoryFilter } = useApp();
  const [query, setQuery] = useState("");

  const visible = registry.filter((tool) => {
    const inCategory = !categoryFilter || tool.category === categoryFilter;
    const inQuery = t(tool.titleKey, lang).toLowerCase().includes(query.toLowerCase());
    return inCategory && inQuery;
  });

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t("app.tagline", lang)}</h1>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("home.search", lang)}
        style={{
          width: "100%", maxWidth: 520, marginTop: 16, padding: "10px 14px",
          borderRadius: "var(--radius-pill)", border: "1px solid var(--border)",
          background: "var(--card)", color: "var(--text)", fontSize: 14,
          boxShadow: "var(--shadow-card)",
        }}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginTop: 24 }}>
        {visible.map((tool) => (
          <button
            key={tool.id}
            onClick={() => navigate({ kind: "tool", toolId: tool.id })}
            style={{
              textAlign: "left", padding: 16, borderRadius: "var(--radius-tile)",
              border: "1px solid var(--border)", background: "var(--card)",
              color: "var(--text)", cursor: "pointer",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <strong>{t(tool.titleKey, lang)}</strong>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
              {t(tool.descKey, lang)}
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}
