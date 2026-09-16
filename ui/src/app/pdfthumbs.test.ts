import { describe, it, expect } from "vitest";
import { normalizeRotate } from "./pdfthumbs";

describe("normalizeRotate", () => {
  it("keeps the four legal /Rotate values", () => {
    expect([0, 90, 180, 270].map(normalizeRotate)).toEqual([0, 90, 180, 270]);
  });

  it("wraps values outside 0..360", () => {
    expect(normalizeRotate(360)).toBe(0);
    expect(normalizeRotate(450)).toBe(90);
    expect(normalizeRotate(-90)).toBe(270);
    expect(normalizeRotate(-450)).toBe(270);
  });
});
