import { Settings as SettingsIcon } from "lucide-react";
import { useApp } from "../app/store";
import { t } from "@pogopdf/i18n";
import type { Category } from "../tools/registry";

const NAV: ({ key: string } & ({ cat: Category } | { cat?: undefined }))[] = [
  { key: "nav.all" },
  { key: "nav.organize", cat: "organize" },
  { key: "nav.convertTo", cat: "convertTo" },
  { key: "nav.convertFrom", cat: "convertFrom" },
  { key: "nav.edit", cat: "edit" },
  { key: "nav.secure", cat: "secure" },
  { key: "nav.utility", cat: "utility" },
];

export function TopNav() {
  const { navigate, lang, categoryFilter, setCategoryFilter } = useApp();

  const selectCategory = (cat: Category | undefined) => {
    setCategoryFilter(cat ?? null);
    navigate({ kind: "home" });
  };

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        background: "var(--card)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <button
        onClick={() => navigate({ kind: "home" })}
        style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer" }}
      >
        <span
          style={{
            width: 18, height: 18, borderRadius: 6, display: "inline-block",
            backgroundImage: "url(logo.png)", backgroundSize: "contain",
            backgroundRepeat: "no-repeat", backgroundPosition: "center",
          }}
          role="img"
          aria-label={t("app.name", lang)}
        />
        <strong style={{ color: "var(--text)" }}>{t("app.name", lang)}</strong>
      </button>
      {NAV.map((n) => {
        const active = (n.cat ?? null) === categoryFilter;
        return (
          <button
            key={n.key}
            onClick={() => selectCategory(n.cat)}
            style={{
              padding: "5px 12px",
              borderRadius: "var(--radius-pill)",
              border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
              background: active ? "var(--accent)" : "var(--bg)",
              color: active ? "var(--accent-contrast)" : "var(--text)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t(n.key, lang)}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      <button
        onClick={() => navigate({ kind: "settings" })}
        aria-label={t("nav.settings", lang)}
        style={{
          padding: "5px 12px", borderRadius: "var(--radius-pill)",
          border: "1px solid var(--border)", background: "var(--bg)",
          color: "var(--muted)", cursor: "pointer",
          display: "flex", alignItems: "center",
        }}
      >
        <SettingsIcon size={16} />
      </button>
    </header>
  );
}
