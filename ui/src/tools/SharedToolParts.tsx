import type { ReactNode } from "react";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../app/store";
import { FileQueueCards } from "./FileQueueCards";

/** Card surface used by the pick/done/running phases. */
export const CARD_STYLE = {
  background: "var(--card)",
  borderRadius: "var(--radius-card)",
  padding: 20,
  boxShadow: "var(--shadow-card)",
} as const;

const PLAIN_CARD_STYLE = {
  background: "var(--card)",
  borderRadius: "var(--radius-card)",
  padding: 20,
} as const;

/**
 * Intake drop zone shared by every file/data tool screen. Idle/drag styling and
 * the drop-zone wording (multi vs single, optional override) are identical across
 * tools; the surrounding card is the screen's concern.
 */
export function DropZone({
  toolId,
  isDragActive,
  multiple,
  onClick,
  dropKeys,
}: {
  toolId: string;
  isDragActive: boolean;
  multiple: boolean;
  onClick: () => void;
  dropKeys?: { multiple: string; single: string };
}) {
  const { lang } = useApp();
  return (
    <button
      data-testid={`${toolId}-dropzone`}
      onClick={onClick}
      style={{
        width: "100%", padding: "28px 12px", borderRadius: "var(--radius-tile)",
        border: isDragActive ? "2px solid var(--accent)" : "1.5px dashed var(--muted)",
        background: isDragActive ? "color-mix(in srgb, var(--accent) 12%, var(--bg))" : "var(--bg)",
        color: isDragActive ? "var(--accent)" : "var(--muted)",
        fontSize: 14, fontWeight: isDragActive ? 700 : 400, cursor: "pointer",
      }}
    >
      {t(
        isDragActive
          ? "tool.common.dropActive"
          : multiple
            ? (dropKeys?.multiple ?? "tool.common.drop")
            : (dropKeys?.single ?? "tool.common.dropSingle"),
        lang
      )}
    </button>
  );
}

/** Optional muted note under the drop zone. */
export function Footnote({
  footnoteKey,
  testId,
}: {
  footnoteKey?: string;
  testId?: string;
}) {
  const { lang } = useApp();
  if (!footnoteKey) return null;
  return (
    <div data-testid={testId} style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
      {t(footnoteKey, lang)}
    </div>
  );
}

/**
 * The file queue under the drop zone plus the "Add more" button that only
 * multiple-file tools show.
 */
export function Queue({
  toolId,
  files,
  onRemove,
  onAddMore,
}: {
  toolId: string;
  files: string[];
  onRemove: (path: string) => void;
  onAddMore?: () => void;
}) {
  const { lang } = useApp();
  return (
    <>
      <div style={{ marginTop: 12 }}>
        <FileQueueCards toolId={toolId} files={files} onRemove={onRemove} />
      </div>
      {onAddMore && files.length > 0 && (
        <button
          onClick={onAddMore}
          style={{
            marginTop: 12, marginRight: 10, padding: "10px 18px", borderRadius: "var(--radius-pill)",
            fontWeight: 600, background: "transparent", border: "1px solid var(--border)",
            color: "var(--text)", cursor: "pointer",
          }}
        >
          {t("tool.common.addMore", lang)}
        </button>
      )}
    </>
  );
}

/** The running phase: percent, progress bar, cancel action. */
export function RunningCard({
  toolId,
  percent,
  onCancel,
}: {
  toolId: string;
  percent: number;
  onCancel: () => void;
}) {
  const { lang } = useApp();
  return (
    <div style={CARD_STYLE}>
      <div>{t("common.processing", lang)} {percent}%</div>
      <div style={{ height: 8, borderRadius: 999, background: "var(--border)", marginTop: 8 }}>
        <div style={{ width: `${percent}%`, height: "100%", borderRadius: 999, background: "var(--accent)", transition: "width 200ms" }} />
      </div>
      <button
        data-testid={`${toolId}-cancel`}
        onClick={onCancel}
        style={{
          marginTop: 12, padding: "8px 16px", borderRadius: "var(--radius-pill)",
          fontWeight: 600, background: "transparent", border: "1px solid var(--border)",
          color: "var(--text)", cursor: "pointer",
        }}
      >
        {t("common.cancel", lang)}
      </button>
    </div>
  );
}

/** The error phase card: heading, raw engine message, input hint, Back action. */
export function ErrorCard({
  toolId,
  error,
  errorCode,
  onBack,
}: {
  toolId: string;
  error: string;
  errorCode: number | undefined;
  onBack: () => void;
}) {
  const { lang } = useApp();
  return (
    <div data-testid={`${toolId}-error`} style={PLAIN_CARD_STYLE}>
      <div style={{ color: "var(--danger)", fontWeight: 700 }}>{t("common.error", lang)}</div>
      <div
        data-testid={`${toolId}-error-detail`}
        style={{
          marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 13,
          color: "var(--muted)", overflowWrap: "anywhere", wordBreak: "break-word",
        }}
      >
        {error}
      </div>
      {errorCode === TOOL_ERROR_CODES.INVALID_INPUT && (
        <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
          {t("common.checkInput", lang)}
        </div>
      )}
      <button
        onClick={onBack}
        style={{
          display: "block", marginTop: 12, padding: "8px 14px",
          borderRadius: "var(--radius-pill)", fontWeight: 600,
          background: "transparent", border: "1px solid var(--danger)",
          color: "var(--danger)", cursor: "pointer",
        }}
      >
        {t("common.back", lang)}
      </button>
    </div>
  );
}

/** Back-to-home link and tool title shared by every tool screen header. */
export function ToolHeader({ toolId, onBack }: { toolId: string; onBack: () => void }) {
  const { lang } = useApp();
  return (
    <>
      <button
        onClick={onBack}
        style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}
      >
        ← {t("common.back", lang)}
      </button>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: "8px 0" }}>{t(`tool.${toolId}.title`, lang)}</h1>
    </>
  );
}

/** Inline validation message under the form (null key renders nothing). */
export function ValidationMessage({
  toolId,
  errorKey,
}: {
  toolId: string;
  errorKey: string | null;
}) {
  const { lang } = useApp();
  if (!errorKey) return null;
  return (
    <div data-testid={`${toolId}-validation`} style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>
      {t(errorKey, lang)}
    </div>
  );
}

/** Card wrapper for the pick/running/done phases. */
export function Card({ children }: { children: ReactNode }) {
  return <div style={CARD_STYLE}>{children}</div>;
}
