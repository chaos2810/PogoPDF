import { describe, it, expect } from "vitest";
import {
  displayRectFromItem,
  hitTestRun,
  quadFromItem,
  type TextItemLike,
  type TextRun,
} from "./textruns";

// A 20pt run at unrotated baseline (20, 15) on a 200x100 page. pdf.js keeps
// text items in unrotated user space regardless of /Rotate, so the transform
// matrices are the real ones measured from a pdf-lib fixture. The glyph box is
// padded 15% of the font size beyond the nominal ascent/descent so tall glyph
// tops survive the engine's redaction coverage.
const ITEM: TextItemLike = {
  str: "Edit",
  transform: [20, 0, 0, 20, 20, 15],
  width: 34.46,
  fontName: "g_d0_f1",
};
const STYLE = { ascent: 0.718, descent: -0.207 };

describe("quadFromItem", () => {
  it("maps an unrotated run to a padded top-down quad", () => {
    // mediaHeight 100 flips the baseline: topUser = 15 + 0.718*20 + 3 = 32.36,
    // so y = 100 - 32.36 = 67.64; h = 18.5 + 6 = 24.5 (15% pad each side).
    const q = quadFromItem(ITEM, STYLE, 100);
    expect(q).not.toBeNull();
    expect(q!.x).toBeCloseTo(20, 2);
    expect(q!.y).toBeCloseTo(67.64, 2);
    expect(q!.w).toBeCloseTo(34.46, 2);
    expect(q!.h).toBeCloseTo(24.5, 2);
  });

  it("projects a /Rotate 90 run identically to /Rotate 0 through displayRectFromItem", () => {
    // A 90-degree page is a pure axis swap: the quad's user-space geometry
    // is unchanged (pdf.js keeps the item unrotated) and the displayed rect
    // is just the padded glyph box in the rotated frame.
    const q0 = quadFromItem(ITEM, STYLE, 100)!;
    expect(q0.x).toBeCloseTo(20, 2);
    expect(q0.y).toBeCloseTo(67.64, 2);
    expect(q0.w).toBeCloseTo(34.46, 2);
    expect(q0.h).toBeCloseTo(24.5, 2);
    const d90 = displayRectFromItem(ITEM, STYLE, [0, 1, 1, 0, 0, 0])!;
    // [0,1,1,0,0,0] maps user (x,y) to displayed (y,x), so the box spans
    // the padded baseline y span [7.86, 32.36] in x and the run's x span in y.
    expect(d90.x).toBeCloseTo(7.86, 1);
    expect(d90.y).toBeCloseTo(20, 1);
    expect(d90.w).toBeCloseTo(24.5, 1);
    expect(d90.h).toBeCloseTo(34.46, 1);
  });

  it("returns null for empty text and rotated (skewed) text", () => {
    expect(quadFromItem({ ...ITEM, str: "  " }, STYLE, 100)).toBeNull();
    expect(quadFromItem({ ...ITEM, transform: [20, 20, -20, 20, 20, 15] }, STYLE, 100)).toBeNull();
  });

  it("falls back to default ascent/descent when the style is absent", () => {
    const q = quadFromItem(ITEM, undefined, 100)!;
    // (0.8 - -0.2)*20 + 6 = 26.
    expect(q.h).toBeCloseTo(26, 2);
  });
});

describe("displayRectFromItem", () => {
  it("projects a run through the rotate-0 viewport (page 2 of the fixture)", () => {
    // viewport [1, 0, 0, -1, 0, 100]: y is flipped into the top-down display.
    const item: TextItemLike = {
      str: "Mark", transform: [10, 0, 0, 10, 30, 25], width: 22.22, fontName: "f",
    };
    const d = displayRectFromItem(item, STYLE, [1, 0, 0, -1, 0, 100])!;
    // topUser = 25 + 0.718*10 + 1.5 = 33.68 -> display y = 100 - 33.68 = 66.32;
    // the box spans the padded glyph extent 12.25pt tall.
    expect(d.x).toBeCloseTo(30, 2);
    expect(d.y).toBeCloseTo(66.32, 2);
    expect(d.w).toBeCloseTo(22.22, 2);
    expect(d.h).toBeCloseTo(12.25, 2);
  });

  it("projects a run through the rotate-90 viewport (page 1 of the fixture)", () => {
    // viewport [0, 1, 1, 0, 0, 0] swaps the axes.
    const d = displayRectFromItem(ITEM, STYLE, [0, 1, 1, 0, 0, 0])!;
    // The displayed rect is the rotated padded glyph box; width/height swap.
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.y).toBeGreaterThanOrEqual(0);
    expect(d.w).toBeCloseTo(24.5, 1);
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
