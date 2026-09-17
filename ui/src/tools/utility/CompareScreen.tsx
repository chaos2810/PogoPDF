import type { ReactNode } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import type { ComparePdfsData } from "@pogopdf/contracts";
import { useApp } from "../../app/store";
import { t } from "@pogopdf/i18n";
import { DataToolScreen } from "../convertout/DataToolScreen";

export function CompareScreen() {
  const { lang } = useApp();

  const build = (data: unknown): ReactNode => {
    const d = data as ComparePdfsData;
    const rows: [string, string][] = [
      ["tool.comparePdfs.labelPagesA", String(d.pageCountA)],
      ["tool.comparePdfs.labelPagesB", String(d.pageCountB)],
      [
        "tool.comparePdfs.labelSameCounts",
        t(d.samePageCounts ? "tool.comparePdfs.yes" : "tool.comparePdfs.no", lang),
      ],
      [
        "tool.comparePdfs.labelDiffering",
        d.differingPages.length > 0 ? d.differingPages.join(", ") : "—",
      ],
      [
        "tool.comparePdfs.labelSizeMismatch",
        d.pageSizeMismatchPages.length > 0 ? d.pageSizeMismatchPages.join(", ") : "—",
      ],
    ];
    return (
      <dl data-testid="data-rows" style={{ margin: 0 }}>
        {rows.map(([labelKey, value]) => (
          <div
            key={labelKey}
            data-testid="data-row"
            style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}
          >
            <dt style={{ flex: "0 0 180px", color: "var(--muted)", fontWeight: 600, fontSize: 13 }}>
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
      toolId={TOOL_IDS.comparePdfs}
      ctaKey="tool.comparePdfs.cta"
      minFiles={2}
      footnoteKey="tool.comparePdfs.similarityHint"
      validationError={(files) =>
        files.length > 0 && files.length !== 2 ? "tool.common.needTwo" : null
      }
      renderData={build}
    />
  );
}
