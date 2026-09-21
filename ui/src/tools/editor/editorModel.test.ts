import { describe, it, expect, beforeEach } from "vitest";
import {
  HANDLES,
  addItem,
  appendPoint,
  createItem,
  deleteItem,
  emptyDoc,
  handlePositions,
  hitTest,
  isSaveable,
  itemsForPage,
  moveItem,
  moveItemById,
  moveRect,
  normalizeRect,
  rectFromPoints,
  resetIdSeq,
  resizeItem,
  resizeItemById,
  resizeRect,
  selectItem,
  toAnnotation,
  toAnnotations,
  updateItem,
  type EditorItem,
} from "./editorModel";

beforeEach(() => resetIdSeq());

const rect = { x: 100, y: 200, w: 80, h: 40 };

function item(init: Partial<EditorItem> = {}): EditorItem {
  return createItem({ type: "rect", page: 1, rect: { ...rect }, ...init });
}

describe("rect normalization", () => {
  it("keeps an already-positive rect unchanged", () => {
    expect(normalizeRect(rect)).toEqual(rect);
  });

  it("flips a rect with negative width/height to the top-left form", () => {
    expect(normalizeRect({ x: 180, y: 240, w: -80, h: -40 })).toEqual({
      x: 100,
      y: 200,
      w: 80,
      h: 40,
    });
  });

  it("rectFromPoints spans both corners regardless of drag direction", () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 30, y: 50 })).toEqual({
      x: 10,
      y: 20,
      w: 20,
      h: 30,
    });
    expect(rectFromPoints({ x: 30, y: 50 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      w: 20,
      h: 30,
    });
  });
});

describe("move", () => {
  it("moveRect shifts without resizing", () => {
    expect(moveRect(rect, 5, -10)).toEqual({ x: 105, y: 190, w: 80, h: 40 });
  });

  it("moveItem shifts the rect and every freehand point", () => {
    const ink = item({
      type: "freehand",
      rect: undefined,
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    });
    expect(moveItem(ink, 10, 20).points).toEqual([
      { x: 11, y: 22 },
      { x: 13, y: 24 },
    ]);
  });

  it("moveItemById moves only the named item and marks dirty", () => {
    let doc = emptyDoc;
    const a = item({ id: "a" });
    const b = item({ id: "b", rect: { x: 0, y: 0, w: 10, h: 10 } });
    doc = addItem(addItem(doc, a), b);
    doc = moveItemById(doc, "a", 1, 1);
    expect(doc.items[0].rect).toEqual({ x: 101, y: 201, w: 80, h: 40 });
    expect(doc.items[1].rect).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(doc.dirty).toBe(true);
  });
});

describe("resize (8 handles)", () => {
  it("exposes one anchor per handle, in displayed coordinates", () => {
    const p = handlePositions(rect);
    expect(Object.keys(p).sort()).toEqual([...HANDLES].sort());
    expect(p.nw).toEqual({ x: 100, y: 200 });
    expect(p.se).toEqual({ x: 180, y: 240 });
    expect(p.n).toEqual({ x: 140, y: 200 });
    expect(p.w).toEqual({ x: 100, y: 220 });
  });

  it("grows and shrinks from each edge", () => {
    expect(resizeRect(rect, "e", 20, 0)).toEqual({ x: 100, y: 200, w: 100, h: 40 });
    expect(resizeRect(rect, "w", 20, 0)).toEqual({ x: 120, y: 200, w: 60, h: 40 });
    expect(resizeRect(rect, "s", 0, 10)).toEqual({ x: 100, y: 200, w: 80, h: 50 });
    expect(resizeRect(rect, "n", 0, 10)).toEqual({ x: 100, y: 210, w: 80, h: 30 });
  });

  it("moves a corner along both axes", () => {
    expect(resizeRect(rect, "nw", 10, 20)).toEqual({ x: 110, y: 220, w: 70, h: 20 });
    expect(resizeRect(rect, "ne", -10, 5)).toEqual({ x: 100, y: 205, w: 70, h: 35 });
    expect(resizeRect(rect, "se", 10, 5)).toEqual({ x: 100, y: 200, w: 90, h: 45 });
    expect(resizeRect(rect, "sw", -10, -5)).toEqual({ x: 90, y: 200, w: 90, h: 35 });
  });

  it("flips instead of collapsing when an edge crosses its opposite", () => {
    // Drag the west edge 200px right, past the east edge at 180.
    expect(resizeRect(rect, "w", 200, 0)).toEqual({ x: 180, y: 200, w: 120, h: 40 });
    // Drag the north edge 100px down, past the south edge at 240.
    expect(resizeRect(rect, "n", 0, 100)).toEqual({ x: 100, y: 240, w: 80, h: 60 });
  });

  it("resizeItem no-ops on a freehand mark with no rect", () => {
    const ink = item({ type: "freehand", rect: undefined, points: [{ x: 0, y: 0 }] });
    expect(resizeItem(ink, "se", 10, 10)).toBe(ink);
  });

  it("resizeItemById resizes only the named item", () => {
    let doc = emptyDoc;
    doc = addItem(doc, item({ id: "a" }));
    doc = addItem(doc, item({ id: "b", rect: { x: 0, y: 0, w: 10, h: 10 } }));
    doc = resizeItemById(doc, "a", "se", 20, 20);
    expect(doc.items[0].rect).toEqual({ x: 100, y: 200, w: 100, h: 60 });
    expect(doc.items[1].rect).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });
});

describe("freehand points", () => {
  it("appendPoint grows the path without mutating the original", () => {
    const base = [{ x: 0, y: 0 }];
    const next = appendPoint(base, { x: 5, y: 5 });
    expect(next).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
    expect(base).toHaveLength(1);
  });

  it("hit tests a freehand path inside its bounding box", () => {
    let doc = emptyDoc;
    doc = addItem(
      doc,
      item({
        id: "ink",
        type: "freehand",
        rect: undefined,
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 40 },
        ],
      })
    );
    expect(hitTest(doc, 1, { x: 20, y: 25 })).toBe("ink");
    expect(hitTest(doc, 1, { x: 100, y: 100 })).toBeNull();
  });
});

describe("selection and hit testing", () => {
  it("hitTest ignores other pages and returns the topmost match", () => {
    let doc = emptyDoc;
    doc = addItem(doc, item({ id: "low", page: 1 }));
    doc = addItem(doc, item({ id: "high", page: 1 }));
    doc = addItem(doc, item({ id: "other", page: 2 }));
    expect(hitTest(doc, 1, { x: 140, y: 220 })).toBe("high");
    expect(hitTest(doc, 2, { x: 140, y: 220 })).toBe("other");
    expect(hitTest(doc, 3, { x: 140, y: 220 })).toBeNull();
  });

  it("selectItem stores the id and updateItem patches one mark", () => {
    let doc = addItem(emptyDoc, item({ id: "a" }));
    doc = selectItem(doc, "a");
    expect(doc.selectedId).toBe("a");
    doc = updateItem(doc, "a", { color: "#2563EB", text: "note" });
    expect(doc.items[0].color).toBe("#2563EB");
    expect(doc.items[0].text).toBe("note");
    expect(doc.dirty).toBe(true);
  });

  it("itemsForPage filters by page", () => {
    let doc = emptyDoc;
    doc = addItem(doc, item({ id: "a", page: 1 }));
    doc = addItem(doc, item({ id: "b", page: 2 }));
    expect(itemsForPage(doc, 1).map((i) => i.id)).toEqual(["a"]);
  });

  it("deleteItem drops the mark and clears its selection", () => {
    let doc = addItem(emptyDoc, item({ id: "a" }));
    doc = selectItem(doc, "a");
    doc = deleteItem(doc, "a");
    expect(doc.items).toEqual([]);
    expect(doc.selectedId).toBeNull();
    expect(doc.dirty).toBe(true);
  });
});

describe("serialization", () => {
  it("keeps only the fields the contract requires per type", () => {
    const rectItem = item({ id: "a", rect: { ...rect }, text: undefined });
    const annot = toAnnotation(rectItem) as Record<string, unknown>;
    expect(annot.id).toBeUndefined();
    expect(annot).toMatchObject({ type: "rect", page: 1, rect });
  });

  it("drops incomplete marks that the engine would reject", () => {
    expect(isSaveable(item({ type: "freehand", rect: undefined, points: [{ x: 0, y: 0 }] }))).toBe(
      false
    );
    expect(isSaveable(item({ type: "freetext", rect: { ...rect }, text: "" }))).toBe(false);
    expect(isSaveable(item({ type: "image", rect: undefined }))).toBe(false);
    expect(isSaveable(item({ type: "freehand", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }))).toBe(
      true
    );
    expect(isSaveable(item({ type: "image", imagePath: "C:\\x.png" }))).toBe(true);
  });

  it("toAnnotations keeps completed marks only, in insertion order", () => {
    let doc = emptyDoc;
    doc = addItem(doc, item({ id: "a" }));
    doc = addItem(doc, item({ id: "b", type: "freetext", text: "" }));
    doc = addItem(doc, item({ id: "c", type: "freetext", text: "note" }));
    expect(toAnnotations(doc).map((a) => a.type)).toEqual(["rect", "freetext"]);
  });
});
