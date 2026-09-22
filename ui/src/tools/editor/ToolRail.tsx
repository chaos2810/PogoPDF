import type { ComponentType } from "react";
import {
  ArrowUpRight,
  Circle,
  Highlighter,
  ImagePlus,
  Minus,
  MousePointer2,
  Pencil,
  Square,
  SquareSlash,
  SpellCheck,
  Strikethrough,
  TextCursorInput,
  Type,
  Underline,
} from "lucide-react";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import type { AnnotationType } from "./editorModel";

// The rail spans the persisted annotation tools plus two editor-only actions
// that have no annotation type: the in-place text edit (editText) and the
// built-in select tool.
export type EditorTool = "select" | "textEdit" | AnnotationType;

type IconCmp = ComponentType<{ size?: string | number; strokeWidth?: string | number }>;

export const EDITOR_TOOLS: { id: EditorTool; icon: IconCmp; key: string }[] = [
  { id: "select", icon: MousePointer2, key: "tool.editor.toolSelect" },
  { id: "textEdit", icon: SpellCheck, key: "tool.editor.toolTextEdit" },
  { id: "text", icon: Type, key: "tool.editor.toolText" },
  { id: "highlight", icon: Highlighter, key: "tool.editor.toolHighlight" },
  { id: "underline", icon: Underline, key: "tool.editor.toolUnderline" },
  { id: "strikeout", icon: Strikethrough, key: "tool.editor.toolStrikeout" },
  { id: "rect", icon: Square, key: "tool.editor.toolRect" },
  { id: "ellipse", icon: Circle, key: "tool.editor.toolEllipse" },
  { id: "line", icon: Minus, key: "tool.editor.toolLine" },
  { id: "arrow", icon: ArrowUpRight, key: "tool.editor.toolArrow" },
  { id: "freehand", icon: Pencil, key: "tool.editor.toolFreehand" },
  { id: "redact", icon: SquareSlash, key: "tool.editor.toolRedact" },
  { id: "image", icon: ImagePlus, key: "tool.editor.toolImage" },
  { id: "freetext", icon: TextCursorInput, key: "tool.editor.toolFreetext" },
];

export function ToolRail({
  active,
  onSelect,
}: {
  active: EditorTool;
  onSelect: (tool: EditorTool) => void;
}) {
  const { lang } = useApp();
  return (
    <nav
      data-testid="editor-tool-rail"
      aria-label={t("tool.editor.toolLabel", lang)}
      style={{
        display: "flex", flexDirection: "column", gap: 4, padding: 6,
        background: "var(--card)", borderRight: "1px solid var(--border)",
        overflowY: "auto", flexShrink: 0,
      }}
    >
      {EDITOR_TOOLS.map(({ id, icon: Icon, key }) => {
        const label = t(key, lang);
        const isActive = active === id;
        return (
          <button
            key={id}
            data-testid={`editor-tool-${id}`}
            data-active={isActive ? "true" : "false"}
            aria-label={label}
            aria-pressed={isActive}
            title={label}
            onClick={() => onSelect(id)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, padding: 0, borderRadius: 8,
              border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
              background: isActive ? "var(--accent)" : "var(--bg)",
              color: isActive ? "var(--accent-contrast)" : "var(--text)",
              cursor: "pointer",
            }}
          >
            <Icon size={18} strokeWidth={2} />
          </button>
        );
      })}
    </nav>
  );
}
