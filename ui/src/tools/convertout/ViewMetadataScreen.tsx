import type { ReactNode } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import type { MetadataData } from "@pogopdf/contracts";
import { useApp } from "../../app/store";
import { t } from "@pogopdf/i18n";
import { DataToolScreen } from "./DataToolScreen";

// Technical units stay literal (KB/MB); they read the same in every language.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ViewMetadataScreen() {
  const { lang } = useApp();

  const build = (data: unknown): ReactNode => {
    const m = data as MetadataData;
    const cells: [string, string][] = [
      ["tool.viewMetadata.labelTitle", m.title ?? "-"],
      ["tool.viewMetadata.labelAuthor", m.author ?? "-"],
      ["tool.viewMetadata.labelSubject", m.subject ?? "-"],
      ["tool.viewMetadata.labelKeywords", m.keywords ?? "-"],
      ["tool.viewMetadata.labelCreator", m.creator ?? "-"],
      ["tool.viewMetadata.labelProducer", m.producer ?? "-"],
      ["tool.viewMetadata.labelCreated", m.creationDate ?? "-"],
      ["tool.viewMetadata.labelModified", m.modificationDate ?? "-"],
      ["tool.viewMetadata.labelPageCount", String(m.pageCount)],
      ["tool.viewMetadata.labelFileSize", formatBytes(m.fileSizeBytes)],
    ];
    return (
      <dl data-testid="data-rows" style={{ margin: 0 }}>
        {cells.map(([labelKey, value]) => (
          <div
            key={labelKey}
            data-testid="data-row"
            style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}
          >
            <dt style={{ flex: "0 0 140px", color: "var(--muted)", fontWeight: 600, fontSize: 13 }}>
              {t(labelKey, lang)}
            </dt>
            <dd style={{ margin: 0, minWidth: 0, flex: 1, overflowWrap: "anywhere", wordBreak: "break-word" }}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    );
  };

  return (
    <DataToolScreen
      toolId={TOOL_IDS.viewMetadata}
      ctaKey="tool.viewMetadata.cta"
      renderData={build}
    />
  );
}
