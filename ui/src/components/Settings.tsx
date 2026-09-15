import { useApp } from "../app/store";
import { t } from "@pogopdf/i18n";

export function Settings() {
  const { theme, setTheme, lang, setLang } = useApp();
  return (
    <main style={{ padding: 24, maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>{t("nav.settings", lang)}</h1>

      <section style={{ marginTop: 20 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {(["system", "light", "dark"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setTheme(opt)}
              style={{
                padding: "6px 14px", borderRadius: "var(--radius-pill)",
                border: `1px solid ${theme === opt ? "var(--accent)" : "var(--border)"}`,
                background: theme === opt ? "var(--accent)" : "var(--card)",
                color: theme === opt ? "var(--accent-contrast)" : "var(--text)",
                cursor: "pointer", fontWeight: 600,
              }}
            >
              {t(`theme.${opt}`, lang)}
            </button>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {(["en", "zh-TW"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              style={{
                padding: "6px 14px", borderRadius: "var(--radius-pill)",
                border: `1px solid ${lang === l ? "var(--accent)" : "var(--border)"}`,
                background: lang === l ? "var(--accent)" : "var(--card)",
                color: lang === l ? "var(--accent-contrast)" : "var(--text)",
                cursor: "pointer", fontWeight: 600,
              }}
            >
              {l === "en" ? "English" : "中文（繁體）"}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
