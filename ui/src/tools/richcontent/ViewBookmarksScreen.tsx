import type { ReactNode } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import type { BookmarkNode } from "@pogopdf/contracts";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { DataToolScreen } from "../convertout/DataToolScreen";

type BookmarkData = { bookmarks: BookmarkNode[] };

// The outline is a tree: each level indents 18px and every row shows its title
// and (1-based) destination page.
function BookmarkTree({ nodes, depth }: { nodes: BookmarkNode[]; depth: number }) {
  const { lang } = useApp();
  return (
    <ul
      data-testid={depth === 0 ? "bookmarks-tree" : undefined}
      style={{ listStyle: "none", padding: 0, margin: 0 }}
    >
      {nodes.map((node, i) => (
        <li key={`${depth}-${i}`} data-testid="bookmark-row" style={{ marginBottom: 4 }}>
          <div
            style={{
              display: "flex", gap: 12, padding: "6px 0",
              paddingLeft: depth * 18,
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>
              {node.title || "-"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: 13, flexShrink: 0 }}>
              {t("tool.viewBookmarks.pageLabel", lang, { page: String(node.page) })}
            </span>
          </div>
          {node.children.length > 0 && (
            <BookmarkTree nodes={node.children} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function ViewBookmarksScreen() {
  const { lang } = useApp();

  const build = (data: unknown): ReactNode => {
    const { bookmarks } = data as BookmarkData;
    if (!bookmarks || bookmarks.length === 0) {
      return (
        <div data-testid="viewBookmarks-empty" style={{ color: "var(--muted)", fontSize: 13 }}>
          {t("tool.viewBookmarks.empty", lang)}
        </div>
      );
    }
    return <BookmarkTree nodes={bookmarks} depth={0} />;
  };

  return (
    <DataToolScreen
      toolId={TOOL_IDS.viewBookmarks}
      ctaKey="tool.viewBookmarks.cta"
      renderData={build}
    />
  );
}
