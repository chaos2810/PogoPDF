import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronLeft, ChevronRight, Loader2, Save, Search as SearchIcon, ZoomIn, ZoomOut } from "lucide-react";
import { t } from "@pogopdf/i18n";
import { useApp } from "../../app/store";
import { onProgress, pickFiles, pickImages, startJob } from "../../app/rpc";
import { openPdfDoc, type PdfDocHandle } from "../../app/pdfpage";
import { SaveAsBar } from "../../components/SaveAsBar";
import { basename } from "../paths";
import { AnnotationLayer, toPx } from "./AnnotationLayer";
import {
  addItem,
  createItem,
  deleteItem,
  emptyDoc,
  findItem,
  hitTest,
  itemsForPage,
  moveItem,
  normalizeRect,
  resizeRect,
  selectItem,
  toAnnotations,
  updateItem,
  type AnnotationType,
  type EditorDoc,
  type EditorItem,
  type Handle,
  type Point,
} from "./editorModel";
import { SearchPanel, type SearchMatch } from "./SearchPanel";
import { ToolRail, type EditorTool } from "./ToolRail";

type Phase = "pick" | "loading" | "editor" | "running" | "done" | "error";

/** Movement in px before a pointer press counts as a drag (organize idiom). */
const DRAG_THRESHOLD = 5;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
const PULSE_MS = 1400;

const RECT_TOOLS = new Set<EditorTool>([
  "rect", "ellipse", "line", "arrow", "highlight", "underline", "strikeout", "redact",
]);

type Defaults = {
  color: string;
  opacity: number;
  lineWidth: number;
  fontSize: number;
};

function defaultsFor(tool: EditorTool): Defaults {
  switch (tool) {
    case "highlight":
      return { color: "#FACC15", opacity: 0.4, lineWidth: 2, fontSize: 14 };
    case "redact":
      return { color: "#000000", opacity: 1, lineWidth: 2, fontSize: 14 };
    case "text":
    case "freetext":
      return { color: "#DC2626", opacity: 1, lineWidth: 2, fontSize: 14 };
    default:
      return { color: "#DC2626", opacity: 1, lineWidth: 2, fontSize: 14 };
  }
}

const ICON_BUTTON: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 30, height: 30, padding: 0, borderRadius: 8,
  border: "1px solid var(--border)", background: "var(--bg)",
  color: "var(--text)", cursor: "pointer",
};

export function EditorScreen() {
  const { lang, navigate } = useApp();
  const [phase, setPhase] = useState<Phase>("pick");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfDocHandle | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [bitmap, setBitmap] = useState<string | null>(null);
  const [pageW, setPageW] = useState(0);
  const [pageH, setPageH] = useState(0);
  const [tool, setTool] = useState<EditorTool>("select");
  const [doc, setDoc] = useState<EditorDoc>(emptyDoc);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [percent, setPercent] = useState(0);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pulse, setPulse] = useState<{ page: number; x: number; y: number } | null>(null);

  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const bitmapToken = useRef(0);
  // The live pdf.js handle, kept in a ref so a replace/unmount can destroy it
  // (and its worker) without depending on state closure timing.
  const pdfRef = useRef<PdfDocHandle | null>(null);
  // In-flight pointer gesture handlers, so every cleanup path removes the same refs.
  const gesture = useRef<{ move: (e: PointerEvent) => void; end: (e: PointerEvent) => void } | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const removeGesture = useCallback(() => {
    const g = gesture.current;
    if (!g) return;
    window.removeEventListener("pointermove", g.move);
    window.removeEventListener("pointerup", g.end);
    window.removeEventListener("pointercancel", g.end);
    gesture.current = null;
  }, []);

  useEffect(() => () => removeGesture(), [removeGesture]);
  // Destroy the pdf.js document (and its worker) when the screen unmounts;
  // otherwise every visit to the editor leaks a worker.
  useEffect(
    () => () => {
      void pdfRef.current?.close();
      pdfRef.current = null;
    },
    []
  );
  useEffect(() => onProgress((p) => setPercent(p.percent)), []);

  // Ctrl/Cmd + wheel zooms at the pointer. A native non-passive listener is
  // required: React's onWheel is passive, so preventDefault there is ignored
  // and the browser's own page zoom would fire instead.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => {
        const next = e.deltaY < 0 ? z + ZOOM_STEP : z - ZOOM_STEP;
        return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +next.toFixed(2)));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [phase]);

  // --- load ---
  const load = useCallback(async (path: string) => {
    setPhase("loading");
    setError("");
    try {
      const handle = await openPdfDoc(path);
      // A replace destroys the previous document before the new one is shown.
      void pdfRef.current?.close();
      pdfRef.current = handle;
      const size = await handle.pageSize(0);
      setPdf(handle);
      setFilePath(path);
      setPageCount(handle.pageCount);
      setPage(1);
      setDoc(emptyDoc);
      setEditingId(null);
      setMatches(null);
      setQuery("");
      // Fit the first page to the canvas width, clamped to the zoom range.
      const avail = (pageRef.current?.clientWidth ?? 900) - 48;
      const fit = avail > 0 ? avail / size.widthPt : 1;
      setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fit)));
      setPhase("editor");
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
      const hit = e.payload.paths.find(isPdf);
      if (hit) void load(hit);
    });
    return () => {
      void unEnter.then((f) => f());
      void unOver.then((f) => f());
      void unLeave.then((f) => f());
      void unDrop.then((f) => f());
    };
  }, [load]);

  const doPick = async () => {
    const picked = await pickFiles(false, "pdf");
    if (picked.length === 0) return;
    await load(picked[0]);
  };

  // --- render the current page ---
  useEffect(() => {
    if (!pdf || phase !== "editor") return;
    const token = ++bitmapToken.current;
    let cancelled = false;
    void (async () => {
      try {
        const rendered = await pdf.render(page - 1, zoom);
        if (cancelled || token !== bitmapToken.current) return;
        setBitmap(rendered.dataUrl);
        setPageW(rendered.widthPt);
        setPageH(rendered.heightPt);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, page, zoom, phase]);

  const showPulse = (m: SearchMatch) => {
    setPulse({ page: m.page, x: m.x, y: m.y });
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulse(null), PULSE_MS);
  };

  const goToPage = (next: number) => {
    const clamped = Math.min(pageCount, Math.max(1, next));
    setPage(clamped);
    // Page navigation resets the selection so a mark from another page is
    // never silently moved under the pointer.
    setDoc((d) => selectItem(d, null));
    setEditingId(null);
  };

  // --- pointer geometry ---
  const pointFromEvent = (e: PointerEvent | React.PointerEvent): Point => {
    const el = pageRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  const beginSelect = (start: Point) => {
    const hit = hitTest(doc, page, start);
    if (!hit) {
      setDoc((d) => selectItem(d, null));
      setEditingId(null);
      return;
    }
    const item = findItem(doc, hit);
    if (!item) return;
    setDoc((d) => selectItem(d, hit));
    setEditingId(null);
    if (!item.rect && !item.points) return;

    const origin = { x: start.x, y: start.y };
    // Snapshot the pressed item once; every move re-applies the absolute delta
    // from the press point, so rounding never accumulates.
    const base = item;
    let moved = false;
    const onMove = (e: PointerEvent) => {
      const p = pointFromEvent(e);
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      if (!moved) {
        if (Math.hypot(dx * zoom, dy * zoom) < DRAG_THRESHOLD) return;
        moved = true;
      }
      const movedItem = moveItem(base, dx, dy);
      setDoc((d) => ({
        items: d.items.map((i) => (i.id === hit ? movedItem : i)),
        selectedId: hit,
        dirty: true,
      }));
    };
    const end = () => removeGesture();
    gesture.current = { move: onMove, end };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const beginResize = (id: string, handle: Handle, e: React.PointerEvent) => {
    e.stopPropagation();
    const item = findItem(doc, id);
    if (!item?.rect) return;
    const start = pointFromEvent(e);
    const origin = { ...item.rect };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const p = pointFromEvent(ev);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (!moved) {
        if (Math.hypot(dx * zoom, dy * zoom) < DRAG_THRESHOLD) return;
        moved = true;
      }
      setDoc((d) => ({
        ...d,
        items: d.items.map((i) =>
          i.id === id ? { ...i, rect: resizeRect(origin, handle, dx, dy) } : i
        ),
        dirty: true,
      }));
    };
    const end = () => removeGesture();
    gesture.current = { move: onMove, end };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const beginDraw = (
    start: Point,
    kind: "rect" | "freehand",
    type: AnnotationType
  ) => {
    const defaults = defaultsFor(type);
    let current: Point = start;
    const points: Point[] = [];
    let moved = false;
    const onMove = (e: PointerEvent) => {
      const p = pointFromEvent(e);
      if (!moved && Math.hypot((p.x - start.x) * zoom, (p.y - start.y) * zoom) < DRAG_THRESHOLD) {
        return;
      }
      moved = true;
      current = p;
      if (kind === "freehand") points.push(p);
      const rect = normalizeRect({
        x: start.x, y: start.y, w: current.x - start.x, h: current.y - start.y,
      });
      setDoc((d) => {
        const draft = d.items.find((i) => i.id === "__draft");
        const nextItem: EditorItem = {
          id: "__draft", type, page,
          color: defaults.color, opacity: defaults.opacity,
          lineWidth: defaults.lineWidth, fontSize: defaults.fontSize,
          rect: kind === "rect" ? rect : undefined,
          points: kind === "freehand" ? [...points] : undefined,
        };
        return { ...d, items: draft ? d.items.map((i) => (i.id === "__draft" ? nextItem : i)) : [...d.items, nextItem] };
      });
    };
    const end = () => {
      removeGesture();
      setDoc((d) => ({ ...d, items: d.items.filter((i) => i.id !== "__draft") }));
      const rect = normalizeRect({
        x: start.x, y: start.y, w: current.x - start.x, h: current.y - start.y,
      });
      if (kind === "freehand") {
        if (points.length < 2) return;
        const item = createItem({
          type, page, points: [...points],
          color: defaults.color, opacity: defaults.opacity, lineWidth: defaults.lineWidth,
        });
        setDoc((d) => addItem(d, item));
        return;
      }
      if (type === "image") {
        void (async () => {
          const picked = await pickImages(false);
          if (picked.length === 0) return;
          const fallback = { x: start.x, y: start.y, w: 120, h: 120 };
          const item = createItem({
            type: "image", page,
            rect: moved ? rect : fallback,
            imagePath: picked[0], opacity: 1,
          });
          setDoc((d) => addItem(d, item));
        })();
        return;
      }
      if (!moved) return;
      const item = createItem({
        type, page, rect,
        color: defaults.color, opacity: defaults.opacity,
        lineWidth: defaults.lineWidth, fontSize: defaults.fontSize,
      });
      setDoc((d) => addItem(d, item));
    };
    gesture.current = { move: onMove, end };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !pdf) return;
    // A press on a resize handle is handled by the handle itself.
    if ((e.target as HTMLElement).closest('[data-testid^="editor-handle-"]')) return;
    // Stop the browser's default mousedown focus/selection: it lands on the
    // page div after React mounts the inline text input, which would blur (and
    // so delete) the just-placed empty mark.
    e.preventDefault();
    const start = pointFromEvent(e);

    if (tool === "select") {
      beginSelect(start);
      return;
    }
    if (tool === "text" || tool === "freetext") {
      const defaults = defaultsFor(tool);
      const rect = { x: start.x, y: start.y, w: 160, h: tool === "text" ? 24 : 40 };
      const item = createItem({
        type: tool === "text" ? "text" : "freetext", page, rect,
        color: defaults.color, opacity: defaults.opacity, fontSize: defaults.fontSize,
        text: "",
      });
      setDoc((d) => addItem(d, item));
      setEditingId(item.id);
      return;
    }
    if (tool === "image") {
      beginDraw(start, "rect", "image");
      return;
    }
    if (tool === "freehand") {
      beginDraw(start, "freehand", "freehand");
      return;
    }
    if (RECT_TOOLS.has(tool)) {
      beginDraw(start, "rect", tool as AnnotationType);
    }
  };

  // --- delete key ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== "editor") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && doc.selectedId) {
        e.preventDefault();
        setDoc((d) => deleteItem(d, d.selectedId!));
        setEditingId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, doc.selectedId]);

  // --- search ---
  const runSearch = async () => {
    if (!filePath || query.trim().length === 0) return;
    setSearchBusy(true);
    setSearchError(null);
    try {
      const result = await startJob("search", { filePath, query: query.trim() });
      if ("data" in result) {
        const data = result.data as { matches?: SearchMatch[] };
        setMatches(data.matches ?? []);
      } else {
        setMatches([]);
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
      setMatches(null);
    } finally {
      setSearchBusy(false);
    }
  };

  // --- save ---
  const annotations = useMemo(() => toAnnotations(doc), [doc]);
  const canSave = annotations.length > 0;

  const runSave = async () => {
    if (!filePath || !canSave) return;
    setPhase("running");
    setPercent(0);
    try {
      const result = await startJob("editorSave", { filePath, annotations });
      if ("outputPath" in result) setOutputPath(result.outputPath);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const reset = () => {
    setOutputPath(null);
    setDoc(emptyDoc);
    setEditingId(null);
    // Reloading the source re-enters the editor phase with a clear document.
    if (filePath) void load(filePath);
  };

  const pageItems = useMemo(() => itemsForPage(doc, page), [doc, page]);
  const selected = findItem(doc, doc.selectedId);
  const editing = findItem(doc, editingId);
  const editingRect = editing?.rect ? normalizeRect(editing.rect) : null;

  // --- pick phase ---
  if (phase === "pick" || phase === "loading") {
    return (
      <main style={{ padding: 24, width: "100%", maxWidth: 720, margin: "0 auto" }}>
        <button
          onClick={() => navigate({ kind: "home" })}
          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}
        >
          ← {t("common.back", lang)}
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: "8px 0" }}>{t("tool.editor.title", lang)}</h1>
        <div style={{ background: "var(--card)", borderRadius: "var(--radius-card)", padding: 20, boxShadow: "var(--shadow-card)" }}>
          <button
            data-testid="editor-dropzone"
            onClick={() => void doPick()}
            style={{
              width: "100%", padding: "28px 12px", borderRadius: "var(--radius-tile)",
              border: isDragActive ? "2px solid var(--accent)" : "1.5px dashed var(--muted)",
              background: isDragActive ? "color-mix(in srgb, var(--accent) 12%, var(--bg))" : "var(--bg)",
              color: isDragActive ? "var(--accent)" : "var(--muted)",
              fontSize: 14, fontWeight: isDragActive ? 700 : 400, cursor: "pointer",
            }}
          >
            {phase === "loading" ? t("tool.editor.loading", lang) : t("tool.editor.drop", lang)}
          </button>
          <div style={{ marginTop: 14, color: "var(--muted)", fontSize: 13 }}>
            {t("tool.editor.hint", lang)}
          </div>
        </div>
      </main>
    );
  }

  if (phase === "error") {
    return (
      <main style={{ padding: 24, width: "100%", maxWidth: 720, margin: "0 auto" }}>
        <button
          onClick={() => navigate({ kind: "home" })}
          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}
        >
          ← {t("common.back", lang)}
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: "8px 0" }}>{t("tool.editor.title", lang)}</h1>
        <div data-testid="editor-error" style={{ background: "var(--card)", borderRadius: "var(--radius-card)", padding: 20, boxShadow: "var(--shadow-card)", color: "var(--danger)" }}>
          {t("common.error", lang)}: {error}
          <button onClick={() => setPhase("pick")} style={{ display: "block", marginTop: 8, cursor: "pointer" }}>
            {t("common.back", lang)}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main
      data-testid="editor-screen"
      style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}
    >
      {/* top bar */}
      <div
        data-testid="editor-topbar"
        style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "8px 12px", background: "var(--card)", borderBottom: "1px solid var(--border)",
        }}
      >
        <button
          onClick={() => navigate({ kind: "home" })}
          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}
        >
          ← {t("common.back", lang)}
        </button>
        <strong
          data-testid="editor-file-name"
          title={filePath ?? undefined}
          style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {filePath ? basename(filePath) : ""}
        </strong>
        <span style={{ color: doc.dirty ? "var(--accent)" : "var(--muted)", fontSize: 12 }}>
          {doc.dirty ? t("tool.editor.dirty", lang) : t("tool.editor.clean", lang)}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <button
            data-testid="editor-page-prev"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            aria-label={t("tool.editor.pagePrev", lang)}
            title={t("tool.editor.pagePrev", lang)}
            style={{ ...ICON_BUTTON, cursor: page <= 1 ? "not-allowed" : "pointer", opacity: page <= 1 ? 0.5 : 1 }}
          >
            <ChevronLeft size={16} />
          </button>
          <input
            data-testid="editor-page-input"
            type="number"
            min={1}
            max={pageCount}
            value={page}
            onChange={(e) => goToPage(Number(e.target.value) || 1)}
            aria-label={t("tool.editor.pageField", lang)}
            style={{
              width: 52, padding: "4px 6px", borderRadius: 8,
              border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)",
              fontSize: 13, textAlign: "center",
            }}
          />
          <span data-testid="editor-page-count" style={{ color: "var(--muted)", fontSize: 13 }}>
            {t("tool.editor.pageOf", lang, { page: String(page), count: String(pageCount) })}
          </span>
          <button
            data-testid="editor-page-next"
            onClick={() => goToPage(page + 1)}
            disabled={page >= pageCount}
            aria-label={t("tool.editor.pageNext", lang)}
            title={t("tool.editor.pageNext", lang)}
            style={{ ...ICON_BUTTON, cursor: page >= pageCount ? "not-allowed" : "pointer", opacity: page >= pageCount ? 0.5 : 1 }}
          >
            <ChevronRight size={16} />
          </button>

          <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />

          <button
            data-testid="editor-zoom-out"
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
            aria-label={t("tool.editor.zoomOut", lang)}
            title={t("tool.editor.zoomOut", lang)}
            style={ICON_BUTTON}
          >
            <ZoomOut size={16} />
          </button>
          <span data-testid="editor-zoom" style={{ color: "var(--muted)", fontSize: 13, minWidth: 44, textAlign: "center" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            data-testid="editor-zoom-in"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
            aria-label={t("tool.editor.zoomIn", lang)}
            title={t("tool.editor.zoomIn", lang)}
            style={ICON_BUTTON}
          >
            <ZoomIn size={16} />
          </button>

          <button
            data-testid="editor-search-toggle"
            data-active={searchOpen ? "true" : "false"}
            onClick={() => setSearchOpen((v) => !v)}
            aria-label={t("tool.editor.searchToggle", lang)}
            title={t("tool.editor.searchToggle", lang)}
            style={{ ...ICON_BUTTON, background: searchOpen ? "var(--accent)" : "var(--bg)", color: searchOpen ? "var(--accent-contrast)" : "var(--text)" }}
          >
            <SearchIcon size={16} />
          </button>

          <button
            data-testid="editor-save"
            onClick={() => void runSave()}
            disabled={!canSave}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 16px", borderRadius: "var(--radius-pill)", fontWeight: 700,
              border: "none",
              background: canSave ? "var(--accent)" : "var(--border)",
              color: canSave ? "var(--accent-contrast)" : "var(--muted)",
              cursor: canSave ? "pointer" : "not-allowed",
            }}
          >
            <Save size={15} />
            {t("tool.editor.save", lang)}
          </button>
        </div>
      </div>

      {/* body */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <ToolRail
          active={tool}
          onSelect={(next) => {
            setTool(next);
            if (next !== "select") setDoc((d) => selectItem(d, null));
            setEditingId(null);
          }}
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div
            ref={canvasRef}
            data-testid="editor-canvas"
            style={{
              flex: 1, overflow: "auto", display: "flex",
              justifyContent: "center", alignItems: "flex-start",
              padding: 24, minHeight: 0,
            }}
          >
            <div
              ref={pageRef}
              data-testid="editor-page"
              onPointerDown={onCanvasPointerDown}
              style={{
                position: "relative",
                width: toPx(pageW, zoom),
                height: toPx(pageH, zoom),
                background: "#FFFFFF",
                boxShadow: "var(--shadow-card)",
                cursor: tool === "select" ? "default" : "crosshair",
                flexShrink: 0,
                touchAction: "none",
              }}
            >
              {bitmap ? (
                <img
                  data-testid="editor-page-bitmap"
                  src={bitmap}
                  alt=""
                  draggable={false}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                />
              ) : (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
                  <Loader2 size={22} className="animate-spin" />
                </div>
              )}

              <AnnotationLayer
                items={pageItems}
                zoom={zoom}
                selectedId={doc.selectedId}
                onHandlePointerDown={beginResize}
              />

              {pulse && pulse.page === page && (
                <div
                  data-testid="editor-search-pulse"
                  style={{
                    position: "absolute",
                    left: toPx(pulse.x, zoom) - 2,
                    top: toPx(pulse.y, zoom) - toPx(14, zoom),
                    width: toPx(140, zoom),
                    height: toPx(18, zoom),
                    background: "color-mix(in srgb, var(--accent) 35%, transparent)",
                    border: "1.5px solid var(--accent)",
                    borderRadius: 3,
                    pointerEvents: "none",
                    animation: "pogopdf-pulse 700ms ease-in-out 2",
                  }}
                />
              )}

              {editing && editingRect && (
                <input
                  autoFocus
                  data-testid="editor-text-input"
                  value={editing.text ?? ""}
                  placeholder={t("tool.editor.textPlaceholder", lang)}
                  onChange={(e) => setDoc((d) => updateItem(d, editing.id, { text: e.target.value }))}
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={() => {
                    if (!(editing.text ?? "").trim()) setDoc((d) => deleteItem(d, editing.id));
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                    if (e.key === "Escape") {
                      setDoc((d) => deleteItem(d, editing.id));
                      setEditingId(null);
                    }
                  }}
                  style={{
                    position: "absolute",
                    left: toPx(editingRect.x, zoom),
                    top: toPx(editingRect.y, zoom),
                    width: toPx(editingRect.w, zoom),
                    height: toPx(editingRect.h, zoom),
                    padding: "2px 4px",
                    border: "1.5px solid var(--accent)",
                    borderRadius: 3,
                    background: "rgba(255,255,255,0.94)",
                    color: editing.color,
                    fontSize: Math.max(8, toPx(editing.fontSize, zoom)),
                  }}
                />
              )}
            </div>
          </div>

          <div
            style={{
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              padding: "6px 14px", background: "var(--card)",
              borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--muted)",
            }}
          >
            <span>{t("tool.editor.hint", lang)}</span>
            {selected?.type === "redact" && (
              <span data-testid="editor-redact-hint" style={{ color: "var(--danger)" }}>
                {t("tool.editor.redactHint", lang)}
              </span>
            )}
          </div>
        </div>

        {searchOpen && (
          <SearchPanel
            query={query}
            onQuery={setQuery}
            onSearch={() => void runSearch()}
            onPick={(m) => {
              goToPage(m.page);
              showPulse(m);
            }}
            onClose={() => setSearchOpen(false)}
            matches={matches}
            busy={searchBusy}
            error={searchError}
          />
        )}
      </div>

      {/* running / done overlay */}
      {(phase === "running" || phase === "done") && (
        <div
          style={{
            position: "absolute", inset: 0, background: "rgba(15,23,42,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}
        >
          <div
            data-testid="editor-save-card"
            style={{
              width: "100%", maxWidth: 460,
              background: "var(--card)", borderRadius: "var(--radius-card)",
              padding: 20, boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
            }}
          >
            {phase === "running" ? (
              <>
                <div>{t("tool.editor.saving", lang)} {percent}%</div>
                <div style={{ height: 8, borderRadius: 999, background: "var(--border)", marginTop: 8 }}>
                  <div style={{ width: `${percent}%`, height: "100%", borderRadius: 999, background: "var(--accent)", transition: "width 200ms" }} />
                </div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700 }}>{t("common.done", lang)}</div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>{t("tool.editor.saveHint", lang)}</div>
                {outputPath && <SaveAsBar outputPath={outputPath} onReset={reset} />}
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
