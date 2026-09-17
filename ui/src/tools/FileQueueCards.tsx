import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { t } from "@pogopdf/i18n";
import { useApp } from "../app/store";
import { getQueueThumb } from "../app/queueThumbs";
import { basename } from "./paths";

// Fixed card width so every tile lines up; the name area is a fixed two lines
// tall (single-line names leave the second line blank) so cards keep one height.
const CARD_WIDTH = 110;
const NAME_HEIGHT = 32;
// Dark scrim so the ✕ reads over light thumbnails; white glyph in both themes.
const REMOVE_CHIP_BG = "rgba(28, 28, 26, 0.55)";

function QueueCard({
  toolId,
  path,
  onRemove,
}: {
  toolId: string;
  path: string;
  onRemove: (path: string) => void;
}) {
  const { lang } = useApp();
  // undefined = still loading, null = no preview available; both paint the
  // placeholder icon, and neither triggers a re-fetch (getQueueThumb memoizes).
  const [thumb, setThumb] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void getQueueThumb(path).then((dataUrl) => {
      if (alive) setThumb(dataUrl);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <li
      data-testid={`${toolId}-file-row`}
      style={{
        width: CARD_WIDTH, display: "flex", flexDirection: "column",
        gap: 6, position: "relative",
      }}
    >
      <div
        data-testid={`${toolId}-file-thumb`}
        style={{
          position: "relative", aspectRatio: "3 / 4", borderRadius: 8,
          background: "var(--bg)", border: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            draggable={false}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        ) : (
          <FileText size={28} color="var(--muted)" strokeWidth={1.5} />
        )}
        <button
          data-testid={`${toolId}-file-remove`}
          className="pogopdf-card-remove"
          onClick={() => onRemove(path)}
          aria-label={`${t("tool.common.remove", lang)}: ${basename(path)}`}
          title={t("tool.common.remove", lang)}
          style={{
            position: "absolute", top: 4, right: 4, width: 26, height: 26,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0, borderRadius: 999, border: "none",
            background: REMOVE_CHIP_BG,
            color: "#FFFFFF", cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--danger)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = REMOVE_CHIP_BG;
          }}
        >
          <X size={14} />
        </button>
      </div>
      <span
        data-testid={`${toolId}-file-name`}
        title={path}
        style={{
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden", height: NAME_HEIGHT, fontSize: 12, lineHeight: "1.3",
          textAlign: "center", overflowWrap: "anywhere", wordBreak: "break-word",
        }}
      >
        {basename(path)}
      </span>
    </li>
  );
}

export function FileQueueCards({
  toolId,
  files,
  onRemove,
}: {
  toolId: string;
  files: string[];
  onRemove: (path: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <ul
      style={{
        listStyle: "none", padding: 0, margin: 0, display: "flex",
        flexWrap: "wrap", gap: 10,
      }}
    >
      {files.map((path) => (
        <QueueCard key={path} toolId={toolId} path={path} onRemove={onRemove} />
      ))}
    </ul>
  );
}
