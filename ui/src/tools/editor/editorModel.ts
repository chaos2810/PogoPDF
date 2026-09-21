import { ANNOTATION_TYPES } from "@pogopdf/contracts";
import type { Annotation, AnnotationPoint, AnnotationRect } from "@pogopdf/contracts";

export type Rect = AnnotationRect;
export type Point = AnnotationPoint;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

/** The client-side mark. `id` is never sent to the engine. */
export type EditorItem = {
  id: string;
  type: AnnotationType;
  page: number;
  color: string;
  opacity: number;
  lineWidth: number;
  fontSize: number;
  rect?: Rect;
  points?: Point[];
  text?: string;
  imagePath?: string;
};

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** The editor's whole client state. Pure functions below return new docs. */
export type EditorDoc = {
  items: EditorItem[];
  selectedId: string | null;
  dirty: boolean;
};

export const emptyDoc: EditorDoc = { items: [], selectedId: null, dirty: false };

let seq = 0;
export function newId(): string {
  return `a${++seq}`;
}

/** Reset the id counter (tests only). */
export function resetIdSeq(): void {
  seq = 0;
}

export const DEFAULT_COLOR = "#DC2626";
export const DEFAULT_OPACITY = 1;
export const DEFAULT_LINE_WIDTH = 2;
export const DEFAULT_FONT_SIZE = 14;

export function createItem(
  init: Partial<EditorItem> & { type: AnnotationType; page: number }
): EditorItem {
  return {
    id: init.id ?? newId(),
    type: init.type,
    page: init.page,
    color: init.color ?? DEFAULT_COLOR,
    opacity: init.opacity ?? DEFAULT_OPACITY,
    lineWidth: init.lineWidth ?? DEFAULT_LINE_WIDTH,
    fontSize: init.fontSize ?? DEFAULT_FONT_SIZE,
    rect: init.rect,
    points: init.points,
    text: init.text,
    imagePath: init.imagePath,
  };
}

/** Flip a rect with negative width/height into the canonical top-left form. */
export function normalizeRect(r: Rect): Rect {
  return {
    x: Math.min(r.x, r.x + r.w),
    y: Math.min(r.y, r.y + r.h),
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

/** A rect spanning two drag points, always positive width/height. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return normalizeRect({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
}

export function moveRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
}

/**
 * Resize a rect by dragging one of eight handles by (dx, dy). Dragging an edge
 * past its opposite edge is allowed: the result is normalized, so the rect
 * flips instead of collapsing to a negative size.
 */
export function resizeRect(r: Rect, handle: Handle, dx: number, dy: number): Rect {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  if (handle.includes("w")) left += dx;
  if (handle.includes("e")) right += dx;
  if (handle.includes("n")) top += dy;
  if (handle.includes("s")) bottom += dy;
  return normalizeRect({ x: left, y: top, w: right - left, h: bottom - top });
}

/** The eight handle anchors in the item's displayed-frame rect. */
export function handlePositions(r: Rect): Record<Handle, Point> {
  return {
    nw: { x: r.x, y: r.y },
    n: { x: r.x + r.w / 2, y: r.y },
    ne: { x: r.x + r.w, y: r.y },
    e: { x: r.x + r.w, y: r.y + r.h / 2 },
    se: { x: r.x + r.w, y: r.y + r.h },
    s: { x: r.x + r.w / 2, y: r.y + r.h },
    sw: { x: r.x, y: r.y + r.h },
    w: { x: r.x, y: r.y + r.h / 2 },
  };
}

/** Every mark carries a rect except freehand, which carries a point path. */
export function hasRect(item: EditorItem): boolean {
  return item.rect != null;
}

export function appendPoint(points: Point[], p: Point): Point[] {
  return [...points, p];
}

/** Shift a mark by a delta, moving freehand points with its rect. */
export function moveItem(item: EditorItem, dx: number, dy: number): EditorItem {
  return {
    ...item,
    rect: item.rect ? moveRect(item.rect, dx, dy) : undefined,
    points: item.points?.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  };
}

/** Resize a mark. Freehand has no rect, so it is returned unchanged. */
export function resizeItem(
  item: EditorItem,
  handle: Handle,
  dx: number,
  dy: number
): EditorItem {
  if (!item.rect) return item;
  return { ...item, rect: resizeRect(item.rect, handle, dx, dy) };
}

/** Topmost mark under a displayed-frame point (last drawn wins). */
export function hitTest(
  doc: EditorDoc,
  page: number,
  pt: Point,
  tol = 4
): string | null {
  const list = doc.items.filter((i) => i.page === page);
  for (let k = list.length - 1; k >= 0; k--) {
    const item = list[k];
    if (item.rect) {
      const r = normalizeRect(item.rect);
      if (
        pt.x >= r.x - tol &&
        pt.x <= r.x + r.w + tol &&
        pt.y >= r.y - tol &&
        pt.y <= r.y + r.h + tol
      ) {
        return item.id;
      }
    } else if (item.points?.length) {
      const xs = item.points.map((p) => p.x);
      const ys = item.points.map((p) => p.y);
      if (
        pt.x >= Math.min(...xs) - tol &&
        pt.x <= Math.max(...xs) + tol &&
        pt.y >= Math.min(...ys) - tol &&
        pt.y <= Math.max(...ys) + tol
      ) {
        return item.id;
      }
    }
  }
  return null;
}

export function itemsForPage(doc: EditorDoc, page: number): EditorItem[] {
  return doc.items.filter((i) => i.page === page);
}

export function findItem(doc: EditorDoc, id: string | null): EditorItem | undefined {
  return id == null ? undefined : doc.items.find((i) => i.id === id);
}

export function addItem(doc: EditorDoc, item: EditorItem): EditorDoc {
  return { items: [...doc.items, item], selectedId: item.id, dirty: true };
}

export function selectItem(doc: EditorDoc, id: string | null): EditorDoc {
  return { ...doc, selectedId: id };
}

export function updateItem(
  doc: EditorDoc,
  id: string,
  patch: Partial<EditorItem>
): EditorDoc {
  return {
    items: doc.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    selectedId: doc.selectedId,
    dirty: true,
  };
}

export function moveItemById(
  doc: EditorDoc,
  id: string,
  dx: number,
  dy: number
): EditorDoc {
  return {
    items: doc.items.map((i) => (i.id === id ? moveItem(i, dx, dy) : i)),
    selectedId: doc.selectedId,
    dirty: true,
  };
}

export function resizeItemById(
  doc: EditorDoc,
  id: string,
  handle: Handle,
  dx: number,
  dy: number
): EditorDoc {
  return {
    items: doc.items.map((i) => (i.id === id ? resizeItem(i, handle, dx, dy) : i)),
    selectedId: doc.selectedId,
    dirty: true,
  };
}

export function deleteItem(doc: EditorDoc, id: string): EditorDoc {
  return {
    items: doc.items.filter((i) => i.id !== id),
    selectedId: doc.selectedId === id ? null : doc.selectedId,
    dirty: true,
  };
}

/**
 * Whether a mark carries the payload AnnotationSchema requires for its type.
 * Incomplete marks (an empty text box, a one-point scribble) are dropped rather
 * than sent to the engine, which would reject the whole save.
 */
export function isSaveable(item: EditorItem): boolean {
  switch (item.type) {
    case "freehand":
      return (item.points?.length ?? 0) >= 2;
    case "text":
    case "freetext":
      return item.rect != null && (item.text?.length ?? 0) > 0;
    case "image":
      return item.imagePath != null;
    default:
      return item.rect != null;
  }
}

/** Strip client ids and serialize to the engine's AnnotationSchema shape. */
export function toAnnotation(item: EditorItem): Annotation {
  const out: Annotation = {
    type: item.type,
    page: item.page,
    color: item.color,
    opacity: item.opacity,
    lineWidth: item.lineWidth,
    fontSize: item.fontSize,
  };
  if (item.rect) out.rect = item.rect;
  if (item.points) out.points = item.points;
  if (item.text !== undefined) out.text = item.text;
  if (item.imagePath !== undefined) out.imagePath = item.imagePath;
  return out;
}

export function toAnnotations(doc: EditorDoc): Annotation[] {
  return doc.items.filter(isSaveable).map(toAnnotation);
}
