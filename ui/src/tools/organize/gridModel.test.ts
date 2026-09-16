import { describe, it, expect } from "vitest";
import {
  initPages,
  rotatePage,
  duplicatePage,
  deletePage,
  movePage,
  toInput,
} from "./gridModel";

describe("gridModel", () => {
  it("initPages numbers srcIndex 0..n-1 with no rotation", () => {
    const pages = initPages([0, 0, 0]);
    expect(pages.map((p) => p.srcIndex)).toEqual([0, 1, 2]);
    expect(pages.every((p) => p.rotate === 0)).toBe(true);
    expect(new Set(pages.map((p) => p.id)).size).toBe(3);
  });

  it("initPages seeds each page's absolute rotation from the intrinsic /Rotate", () => {
    const pages = initPages([90, 0, 180, 270]);
    expect(pages.map((p) => p.rotate)).toEqual([90, 0, 180, 270]);
  });

  it("initPages normalizes out-of-range intrinsic rotation", () => {
    expect(initPages([-90, 450]).map((p) => p.rotate)).toEqual([270, 90]);
  });

  it("rotates in 90° steps and wraps to 0", () => {
    const [p] = initPages([0]);
    let pages = rotatePage([p], p.id);
    expect(pages[0].rotate).toBe(90);
    pages = rotatePage(rotatePage(pages, p.id), p.id);
    expect(pages[0].rotate).toBe(270);
    pages = rotatePage(pages, p.id);
    expect(pages[0].rotate).toBe(0);
  });

  it("duplicates the page in place with a fresh id", () => {
    const pages = initPages([0, 0]);
    const next = duplicatePage(pages, pages[0].id);
    expect(next).toHaveLength(3);
    expect(next.map((p) => p.srcIndex)).toEqual([0, 0, 1]);
    expect(new Set(next.map((p) => p.id)).size).toBe(3);
  });

  it("deletes by id", () => {
    const pages = initPages([0, 0, 0]);
    const next = deletePage(pages, pages[1].id);
    expect(next.map((p) => p.srcIndex)).toEqual([0, 2]);
  });

  it("moves a page and no-ops on bad indices", () => {
    const pages = initPages([0, 0, 0]);
    expect(movePage(pages, 2, 0).map((p) => p.srcIndex)).toEqual([2, 0, 1]);
    expect(movePage(pages, 0, 0)).toBe(pages);
    expect(movePage(pages, 5, 0)).toBe(pages);
    expect(movePage(pages, 0, 9)).toBe(pages);
  });

  it("serializes to the engine input shape", () => {
    const pages = initPages([0, 0]);
    const rotated = rotatePage(pages, pages[1].id);
    expect(toInput(rotated)).toEqual([
      { srcIndex: 0, rotate: 0 },
      { srcIndex: 1, rotate: 90 },
    ]);
  });

  it("preserves intrinsic rotation in serialized output when untouched", () => {
    expect(toInput(initPages([90, 180]))).toEqual([
      { srcIndex: 0, rotate: 90 },
      { srcIndex: 1, rotate: 180 },
    ]);
  });
});
