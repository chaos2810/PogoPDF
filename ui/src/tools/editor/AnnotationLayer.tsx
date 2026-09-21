import { convertFileSrc } from "@tauri-apps/api/core";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { normalizeRect, type EditorItem, type Handle } from "./editorModel";

/** pt -> px: the canvas is rendered at `zoom` pixels per PDF point. */
export function toPx(v: number, zoom: number): number {
  return v * zoom;
}

/** The eight resize handle anchors in px, for a rect in PDF points. */
export function handleAnchors(
  r: { x: number; y: number; w: number; h: number },
  zoom: number
): Record<Handle, { x: number; y: number }> {
  const x = toPx(r.x, zoom);
  const y = toPx(r.y, zoom);
  const w = toPx(r.w, zoom);
  const h = toPx(r.h, zoom);
  return {
    nw: { x, y },
    n: { x: x + w / 2, y },
    ne: { x: x + w, y },
    e: { x: x + w, y: y + h / 2 },
    se: { x: x + w, y: y + h },
    s: { x: x + w / 2, y: y + h },
    sw: { x, y: y + h },
    w: { x, y: y + h / 2 },
  };
}

const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

const MARK_LAYER: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

/** The visual body of one mark, positioned in canvas px over the page bitmap. */
function MarkBody({ item, zoom }: { item: EditorItem; zoom: number }) {
  const { lang } = useApp();
  const opacity = item.opacity;

  if (item.type === "freehand") {
    const d = (item.points ?? [])
      .map((p, i) => `${i === 0 ? "M" : "L"} ${toPx(p.x, zoom)} ${toPx(p.y, zoom)}`)
      .join(" ");
    return (
      <svg style={MARK_LAYER} width="100%" height="100%">
        <path
          d={d}
          fill="none"
          stroke={item.color}
          strokeWidth={Math.max(1, toPx(item.lineWidth, zoom))}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={opacity}
        />
      </svg>
    );
  }

  const r = normalizeRect(item.rect ?? { x: 0, y: 0, w: 0, h: 0 });
  const box: React.CSSProperties = {
    position: "absolute",
    left: toPx(r.x, zoom),
    top: toPx(r.y, zoom),
    width: toPx(r.w, zoom),
    height: toPx(r.h, zoom),
    opacity,
  };
  const strokeWidth = Math.max(1, toPx(item.lineWidth, zoom));

  switch (item.type) {
    case "highlight":
      return <div style={{ ...box, background: item.color }} />;
    case "underline":
      return <div style={{ ...box, borderBottom: `${Math.max(2, 3 * zoom)}px solid ${item.color}` }} />;
    case "strikeout":
      return (
        <div
          style={{
            ...box,
            borderTop: `${Math.max(2, 3 * zoom)}px solid ${item.color}`,
            height: 0,
            marginTop: toPx(r.h, zoom) / 2,
          }}
        />
      );
    case "rect":
      return <div style={{ ...box, border: `${strokeWidth}px solid ${item.color}` }} />;
    case "ellipse":
      return <div style={{ ...box, border: `${strokeWidth}px solid ${item.color}`, borderRadius: "50%" }} />;
    case "line":
      return (
        <svg style={{ ...box, overflow: "visible" }} width={box.width} height={box.height}>
          <line x1={0} y1={0} x2={toPx(r.w, zoom)} y2={toPx(r.h, zoom)} stroke={item.color} strokeWidth={strokeWidth} />
        </svg>
      );
    case "arrow":
      return (
        <svg style={{ ...box, overflow: "visible" }} width={box.width} height={box.height}>
          <defs>
            <marker id={`ah-${item.id}`} markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L8,3 L0,6 Z" fill={item.color} />
            </marker>
          </defs>
          <line
            x1={0}
            y1={0}
            x2={toPx(r.w, zoom)}
            y2={toPx(r.h, zoom)}
            stroke={item.color}
            strokeWidth={strokeWidth}
            markerEnd={`url(#ah-${item.id})`}
          />
        </svg>
      );
    case "redact":
      // The ledger requires a distinctly styled mark until save: a dark,
      // semi-opaque hatch labelled so it reads as "marked", not applied.
      return (
        <div
          data-testid="editor-redact-mark"
          style={{
            ...box,
            background:
              "repeating-linear-gradient(45deg, rgba(17,24,39,0.9) 0 6px, rgba(17,24,39,0.62) 6px 12px)",
            border: "1.5px dashed #FFFFFF",
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              color: "#FFFFFF", fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
              whiteSpace: "nowrap", textShadow: "0 1px 2px rgba(0,0,0,0.8)",
            }}
          >
            {item.text ?? t("tool.editor.redactMark", lang)}
          </span>
        </div>
      );
    case "image": {
      const src = item.imagePath ? convertFileSrc(item.imagePath) : undefined;
      return (
        <div style={box}>
          {src && (
            <img src={src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          )}
        </div>
      );
    }
    case "text":
    case "freetext":
      return (
        <div
          style={{
            ...box,
            color: item.color,
            fontSize: Math.max(8, toPx(item.fontSize, zoom)),
            lineHeight: 1.2,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {item.text}
        </div>
      );
    default:
      return null;
  }
}

/**
 * The annotation overlay. Purely visual: all pointer input is handled by the
 * canvas beneath it (which hit-tests marks), so an unselected mark can never
 * swallow a drag. The selected mark gets an outline plus eight resize handles,
 * which DO take pointer events.
 */
export function AnnotationLayer({
  items,
  zoom,
  selectedId,
  onHandlePointerDown,
}: {
  items: EditorItem[];
  zoom: number;
  selectedId: string | null;
  onHandlePointerDown: (id: string, handle: Handle, e: React.PointerEvent) => void;
}) {
  const selected = items.find((i) => i.id === selectedId);
  const r = selected?.rect ? normalizeRect(selected.rect) : null;

  return (
    <>
      {items.map((item) => (
        <div
          key={item.id}
          data-testid="editor-annotation"
          data-item-id={item.id}
          data-item-type={item.type}
          data-selected={item.id === selectedId ? "true" : "false"}
          style={MARK_LAYER}
        >
          <MarkBody item={item} zoom={zoom} />
        </div>
      ))}

      {selected && r && (
        <div data-testid="editor-selection" style={MARK_LAYER}>
          <div
            style={{
              position: "absolute",
              left: toPx(r.x, zoom),
              top: toPx(r.y, zoom),
              width: toPx(r.w, zoom),
              height: toPx(r.h, zoom),
              border: "1px dashed var(--accent)",
            }}
          />
          {Object.entries(handleAnchors(r, zoom)).map(([handle, pt]) => (
            <div
              key={handle}
              data-testid={`editor-handle-${handle}`}
              data-handle={handle}
              onPointerDown={(e) => onHandlePointerDown(selected.id, handle as Handle, e)}
              style={{
                position: "absolute",
                left: pt.x - 5,
                top: pt.y - 5,
                width: 10,
                height: 10,
                borderRadius: 2,
                background: "var(--accent)",
                border: "1px solid var(--accent-contrast)",
                cursor: HANDLE_CURSOR[handle as Handle],
                pointerEvents: "auto",
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
