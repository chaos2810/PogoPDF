import type { ReactNode } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import type { PageDimensionsData } from "@pogopdf/contracts";
import { useApp } from "../../app/store";
import { t } from "@pogopdf/i18n";
import { DataToolScreen } from "./DataToolScreen";

const cell: React.CSSProperties = {
  padding: "8px 10px",
  textAlign: "left",
  borderBottom: "1px solid var(--border)",
};

export function PageDimensionsScreen() {
  const { lang } = useApp();

  const build = (data: unknown): ReactNode => {
    const { pages } = data as PageDimensionsData;
    return (
      <table
        data-testid="data-rows"
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
      >
        <thead>
          <tr style={{ color: "var(--muted)" }}>
            <th style={cell}>{t("tool.pageDimensions.colPage", lang)}</th>
            <th style={cell}>{t("tool.pageDimensions.colSizePt", lang)}</th>
            <th style={cell}>{t("tool.pageDimensions.colSizeMm", lang)}</th>
            <th style={cell}>{t("tool.pageDimensions.colOrientation", lang)}</th>
            <th style={cell}>{t("tool.pageDimensions.colRotation", lang)}</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((p, i) => (
            <tr key={i}>
              <td style={cell}>{i + 1}</td>
              <td style={cell}>{p.widthPt} × {p.heightPt}</td>
              <td style={cell}>{p.widthMm} × {p.heightMm}</td>
              <td style={cell}>
                {t(`tool.pageDimensions.${p.orientation}`, lang)}
              </td>
              <td style={cell}>{p.rotation}°</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <DataToolScreen
      toolId={TOOL_IDS.pageDimensions}
      ctaKey="tool.pageDimensions.cta"
      renderData={build}
    />
  );
}
