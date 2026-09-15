import { useApp } from "../../app/store";
import { t } from "@pogopdf/i18n";

// Placeholder until Task 8 implements the drag-reorder page grid.
export function OrganizeGridScreen() {
  const { lang, navigate } = useApp();
  return (
    <main style={{ padding: 24, width: "100%", maxWidth: 720, margin: "0 auto" }}>
      <button
        onClick={() => navigate({ kind: "home" })}
        style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}
      >
        ← {t("common.back", lang)}
      </button>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: "8px 0" }}>{t("tool.organize.title", lang)}</h1>
      <div style={{
        background: "var(--card)", borderRadius: "var(--radius-card)",
        padding: 20, boxShadow: "var(--shadow-card)", color: "var(--muted)",
      }}>
        {t("tool.organize.placeholder", lang)}
      </div>
    </main>
  );
}
