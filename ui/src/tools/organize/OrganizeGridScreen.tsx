import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, RotateCw, Trash2 } from "lucide-react";
import { useApp } from "../../app/store";
import { t } from "@pogopdf/i18n";
import { onProgress, pickPdfs, startJob } from "../../app/rpc";
import { renderPdfThumbs, type PdfThumb } from "../../app/pdfthumbs";
import { SaveAsBar } from "../../components/SaveAsBar";
import { basename } from "../paths";
import {
  deletePage,
  duplicatePage,
  initPages,
  movePage,
  rotatePage,
  toInput,
  type GridPage,
} from "./gridModel";

type Phase = "pick" | "loading" | "grid" | "running" | "done" | "error";

// Movement in px before a pointer press counts as a reorder drag.
const DRAG_THRESHOLD = 5;

const ICON_BUTTON: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 26, height: 26, padding: 0, borderRadius: 6,
  border: "1px solid var(--border)", background: "var(--card)",
  color: "var(--text)", cursor: "pointer",
};

// Toolbar pill that doubles as the CTA (filled) and the reset action (ghost).
function ToolbarButton({
  label,
  onClick,
  disabled,
  testId,
  cta = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  cta?: boolean;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 18px", borderRadius: "var(--radius-pill)", fontWeight: 700,
        border: cta ? "none" : "1px solid var(--border)",
        background: cta ? (disabled ? "var(--border)" : "var(--accent)") : "transparent",
        color: cta ? (disabled ? "var(--muted)" : "var(--accent-contrast)") : "var(--text)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

export function OrganizeGridScreen() {
  const { lang, navigate } = useApp();
  const [phase, setPhase] = useState<Phase>("pick");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<PdfThumb[]>([]);
  const [pages, setPages] = useState<GridPage[]>([]);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  // Grabbed source (dimmed) and the cell currently under the pointer (ringed).
  const [dragSource, setDragSource] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const dragFrom = useRef<number | null>(null);
  const dragTo = useRef<number | null>(null);
  // In-flight drag handlers, so every cleanup path removes the exact same refs.
  const dragHandlers = useRef<{
    move: (ev: PointerEvent) => void;
    end: () => void;
  } | null>(null);

  const removeDragListeners = useCallback(() => {
    const handlers = dragHandlers.current;
    if (!handlers) return;
    window.removeEventListener("pointermove", handlers.move);
    window.removeEventListener("pointerup", handlers.end);
    window.removeEventListener("pointercancel", handlers.end);
    window.removeEventListener("lostpointercapture", handlers.end);
    dragHandlers.current = null;
  }, []);

  const endDrag = useCallback(() => {
    removeDragListeners();
    const from = dragFrom.current;
    const to = dragTo.current;
    if (from != null && to != null) setPages((prev) => movePage(prev, from, to));
    dragFrom.current = null;
    dragTo.current = null;
    setDragSource(null);
    setDragOver(null);
  }, [removeDragListeners]);

  useEffect(
    () => () => {
      removeDragListeners();
      dragFrom.current = null;
      dragTo.current = null;
      setDragSource(null);
      setDragOver(null);
    },
    [removeDragListeners]
  );

  useEffect(() => onProgress((p) => setPercent(p.percent)), []);

  const load = useCallback(async (path: string) => {
    setPhase("loading");
    setError("");
    try {
      const rendered = await renderPdfThumbs(path);
      setFilePath(path);
      setThumbs(rendered);
      setPages(initPages(rendered.map((t) => t.rotate)));
      setPhase("grid");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    const win = getCurrentWindow();
    const isPdf = (p: string) => p.toLowerCase().endsWith(".pdf");
    const unEnter = win.listen<{ paths: string[] }>("tauri://drag-enter", (e) => {
      if (e.payload.paths.some(isPdf)) setIsDragActive(true);
    });
    const unOver = win.listen("tauri://drag-over", () => setIsDragActive(true));
    const unLeave = win.listen("tauri://drag-leave", () => setIsDragActive(false));
    const unDrop = win.listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
      setIsDragActive(false);
      const pdf = e.payload.paths.find(isPdf);
      if (pdf) void load(pdf);
    });
    return () => {
      void unEnter.then((f) => f());
      void unOver.then((f) => f());
      void unLeave.then((f) => f());
      void unDrop.then((f) => f());
    };
  }, [load]);

  const pick = async () => {
    const picked = await pickPdfs(false);
    if (picked.length === 0) return;
    await load(picked[0]);
  };

  const reset = () => {
    if (filePath) void load(filePath);
  };

  const run = async () => {
    if (!filePath || pages.length === 0) return;
    setPhase("running");
    setPercent(0);
    try {
      const result = await startJob("organize", {
        filePath,
        pages: toInput(pages),
      });
      // organize is single-output; the multi-file shape belongs to split.
      if ("outputPath" in result) setOutputPath(result.outputPath);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  // Reorder uses pointer events, not HTML5 drag-and-drop: Tauri's native
  // drag-drop handler (which external file drops require) makes the Windows
  // webview swallow HTML5 drag events, so draggable/onDrop never fire there.
  const beginDrag = (index: number) => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    removeDragListeners();

    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    const cellAt = (x: number, y: number): number | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const cell = el?.closest<HTMLElement>('[data-testid="grid-cell"]');
      const attr = cell?.getAttribute("data-index");
      return attr != null ? Number(attr) : null;
    };
    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        started = true;
        dragFrom.current = index;
        setDragSource(index);
      }
      const over = cellAt(ev.clientX, ev.clientY);
      if (over != null) {
        dragTo.current = over;
        setDragOver(over);
      }
    };
    dragHandlers.current = { move: onMove, end: endDrag };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("lostpointercapture", endDrag);
  };

  const header = (
    <>
      <button
        onClick={() => navigate({ kind: "home" })}
        style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}
      >
        ← {t("common.back", lang)}
      </button>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: "8px 0" }}>
        {t("tool.organize.title", lang)}
      </h1>
    </>
  );

  const card: React.CSSProperties = {
    background: "var(--card)", borderRadius: "var(--radius-card)",
    padding: 20, boxShadow: "var(--shadow-card)",
  };

  return (
    <main style={{ padding: 24, width: "100%", maxWidth: 960, margin: "0 auto" }}>
      {header}

      {(phase === "pick" || phase === "loading") && (
        <div style={card}>
          <button
            data-testid="organize-dropzone"
            onClick={() => void pick()}
            style={{
              width: "100%", padding: "28px 12px", borderRadius: "var(--radius-tile)",
              border: isDragActive ? "2px solid var(--accent)" : "1.5px dashed var(--muted)",
              background: isDragActive ? "color-mix(in srgb, var(--accent) 12%, var(--bg))" : "var(--bg)",
              color: isDragActive ? "var(--accent)" : "var(--muted)",
              fontSize: 14, fontWeight: isDragActive ? 700 : 400, cursor: "pointer",
            }}
          >
            {t(
              phase === "loading"
                ? "tool.organize.loading"
                : isDragActive
                  ? "tool.common.dropActive"
                  : "tool.common.dropSingle",
              lang
            )}
          </button>
        </div>
      )}

      {phase === "grid" && (
        <div style={card}>
          <div
            style={{
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <span data-testid="organize-file-name" title={filePath ?? undefined} style={{ fontWeight: 700 }}>
              {filePath ? basename(filePath) : ""}
            </span>
            <span data-testid="organize-count" style={{ color: "var(--muted)", fontSize: 13 }}>
              {t("tool.organize.count", lang, { count: String(pages.length) })}
            </span>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              {t("tool.organize.dragHint", lang)}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <ToolbarButton
                testId="organize-reset"
                label={t("tool.organize.reset", lang)}
                onClick={reset}
              />
              <ToolbarButton
                testId="organize-cta"
                label={t("tool.organize.cta", lang)}
                onClick={() => void run()}
                disabled={pages.length === 0}
                cta
              />
            </div>
          </div>

          {pages.length === 0 && (
            <div data-testid="organize-empty" style={{ color: "var(--muted)", padding: "16px 0" }}>
              {t("tool.organize.empty", lang)}
            </div>
          )}

          <ul
            data-testid="organize-grid"
            style={{
              listStyle: "none", padding: 0, margin: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: 12,
            }}
          >
            {pages.map((page, i) => {
              const thumb = thumbs[page.srcIndex];
              return (
                <li
                  key={page.id}
                  data-testid="grid-cell"
                  data-index={i}
                  onPointerDown={beginDrag(i)}
                  style={{
                    position: "relative", display: "flex", flexDirection: "column",
                    gap: 6, padding: 8, borderRadius: "var(--radius-tile)",
                    border:
                      dragSource === i || dragOver === i
                        ? "2px solid var(--accent)"
                        : "1px solid var(--border)",
                    background:
                      dragOver === i && dragSource !== i
                        ? "color-mix(in srgb, var(--accent) 8%, var(--bg))"
                        : "var(--bg)",
                    cursor: "grab", touchAction: "none",
                    opacity: dragSource === i ? 0.5 : 1,
                  }}
                >
                  <div
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      aspectRatio: "1 / 1", overflow: "hidden",
                    }}
                  >
                    <img
                      data-testid="grid-thumb"
                      src={thumb?.dataUrl}
                      alt=""
                      draggable={false}
                      style={{
                        maxWidth: "100%",
                        maxHeight: "100%",
                        transform: `rotate(${page.rotate}deg)`,
                        transition: "transform 150ms",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
                    <span data-testid="grid-label" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", minWidth: 0 }}>
                      {t("tool.organize.pageLabel", lang, { number: String(i + 1) })}
                    </span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        data-testid="grid-rotate"
                        aria-label={t("tool.organize.rotate", lang)}
                        title={t("tool.organize.rotate", lang)}
                        onClick={() => setPages((prev) => rotatePage(prev, page.id))}
                        style={ICON_BUTTON}
                      >
                        <RotateCw size={14} />
                      </button>
                      <button
                        data-testid="grid-duplicate"
                        aria-label={t("tool.organize.duplicate", lang)}
                        title={t("tool.organize.duplicate", lang)}
                        onClick={() => setPages((prev) => duplicatePage(prev, page.id))}
                        style={ICON_BUTTON}
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        data-testid="grid-delete"
                        aria-label={t("tool.organize.delete", lang)}
                        title={t("tool.organize.delete", lang)}
                        onClick={() => setPages((prev) => deletePage(prev, page.id))}
                        style={{ ...ICON_BUTTON, color: "var(--danger)" }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {phase === "running" && (
        <div style={card}>
          <div>{t("common.processing", lang)} {percent}%</div>
          <div style={{ height: 8, borderRadius: 999, background: "var(--border)", marginTop: 8 }}>
            <div style={{ width: `${percent}%`, height: "100%", borderRadius: 999, background: "var(--accent)", transition: "width 200ms" }} />
          </div>
        </div>
      )}

      {phase === "done" && outputPath && (
        <div style={card}>
          <div style={{ fontWeight: 700 }}>{t("common.done", lang)}</div>
          <SaveAsBar outputPath={outputPath} onReset={() => { setPhase("pick"); setFilePath(null); setPages([]); setThumbs([]); setOutputPath(null); }} />
        </div>
      )}

      {phase === "error" && (
        <div style={{ ...card, color: "var(--danger)" }}>
          {t("common.error", lang)}: {error}
          <button onClick={() => setPhase("pick")} style={{ display: "block", marginTop: 8, cursor: "pointer" }}>
            {t("common.back", lang)}
          </button>
        </div>
      )}
    </main>
  );
}
