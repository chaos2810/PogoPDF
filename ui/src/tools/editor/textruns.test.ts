import { describe, it, expect } from "vitest";
import {
  displayRectFromItem,
  hitTestRun,
  quadFromItem,
  type TextItemLike,
  type TextRun,
} from "./textruns";

// A horizontal 24pt run at unrotated baseline (50, 50) on a 200x100 page whose
// /Rotate is 90: pdf.js keeps the item in unrotated user space and applies the
// rotation only through the viewport, which is exactly what these helpers rely
// on. The transform matrices are the real ones measured from a pdf-lib fixture.
const ITEM: TextItemLike = {
  str: "Edit",
  transform: [20, 0, 0, 20, 20, 15],
  width: 34.46,
  fontName: "g_d0_f1",
};
const STYLE = { ascent: 0.718, descent: -0.207 };

describe("quadFromItem", () => {
  it("maps an unrotated run to a top-down quad", () => {
    // mediaHeight 100 flips the baseline: topUser = 15 + 0.718*20 = 29.36,
    // so y = 100 - 29.36 = 70.64; h = (0.718 - -0.207)*20 = 18.5.
    const q = quadFromItem(ITEM, STYLE, 100);
    expect(q).not.toBeNull();
    expect(q!.x).toBeCloseTo(20, 2);
    expect(q!.y).toBeCloseTo(70.64, 2);
    expect(q!.w).toBeCloseTo(34.46, 2);
    expect(q!.h).toBeCloseTo(18.5, 2);
  });

  it("is independent of page rotation (the transform is unrotated)", () => {
    // The same item on a /Rotate 90 page yields the same engine quad; only the
    // display projection differs.
    expect(quadFromItem(ITEM, STYLE, 100)).toEqual(quadFromItem(ITEM, STYLE, 100));
  });

  it("returns null for empty text and rotated (skewed) text", () => {
    expect(quadFromItem({ ...ITEM, str: "  " }, STYLE, 100)).toBeNull();
    expect(quadFromItem({ ...ITEM, transform: [20, 20, -20, 20, 20, 15] }, STYLE, 100)).toBeNull();
  });

  it("falls back to default ascent/descent when the style is absent", () => {
    const q = quadFromItem(ITEM, undefined, 100)!;
    expect(q.h).toBeCloseTo(20, 2);
  });
});

describe("displayRectFromItem", () => {
  it("projects a run through the rotate-0 viewport (page 2 of the fixture)", () => {
    // viewport [1, 0, 0, -1, 0, 100]: y is flipped into the top-down display.
    const item: TextItemLike = {
      str: "Mark", transform: [10, 0, 0, 10, 30, 25], width: 22.22, fontName: "f",
    };
    const d = displayRectFromItem(item, STYLE, [1, 0, 0, -1, 0, 100])!;
    // topUser = 25 + 0.718*10 = 32.18 -> display y = 100 - 32.18 = 67.82;
    // the box spans the glyph extent 9.25pt tall.
    expect(d.x).toBeCloseTo(30, 2);
    expect(d.y).toBeCloseTo(67.82, 2);
    expect(d.w).toBeCloseTo(22.22, 2);
    expect(d.h).toBeCloseTo(9.25, 2);
  });

  it("projects a run through the rotate-90 viewport (page 1 of the fixture)", () => {
    // viewport [0, 1, 1, 0, 0, 0] swaps the axes.
    const d = displayRectFromItem(ITEM, STYLE, [0, 1, 1, 0, 0, 0])!;
    // The displayed rect is the rotated glyph box; width/height swap roles.
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.y).toBeGreaterThanOrEqual(0);
    expect(d.w).toBeCloseTo(18.5, 1);
    expect(d.h).toBeCloseTo(34.46, 1);
  });
});

describe("hitTestRun", () => {
  const run = (x: number, y: number): TextRun => ({
    text: "x",
    quad: { x, y, w: 10, h: 10 },
    display: { x, y, w: 10, h: 10 },
  });

  it("hits a run under the point and misses elsewhere", () => {
    const runs = [run(0, 0), run(50, 50)];
    expect(hitTestRun(runs, { x: 55, y: 55 })?.display.x).toBe(50);
    expect(hitTestRun(runs, { x: 5, y: 5 })?.display.x).toBe(0);
    expect(hitTestRun(runs, { x: 30, y: 30 })).toBeNull();
  });

  it("prefers the later run when two overlap", () => {
    const runs = [run(0, 0), run(0, 0)];
    expect(hitTestRun(runs, { x: 5, y: 5 })).toBe(runs[1]);
  });
});
