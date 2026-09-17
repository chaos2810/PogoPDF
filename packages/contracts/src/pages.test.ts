import { describe, it, expect } from "vitest";
import { parsePageSelection, PageSelectionError } from "./pages";

describe("parsePageSelection", () => {
  it("parses single, ranges, and mixed", () => {
    expect(parsePageSelection("1", 10)).toEqual([0]);
    expect(parsePageSelection("1-3,5", 10)).toEqual([0, 1, 2, 4]);
    expect(parsePageSelection("8-10", 10)).toEqual([7, 8, 9]);
  });
  it("allows whitespace and collapses duplicates, keeps ascending", () => {
    expect(parsePageSelection(" 5, 1-3 , 5 ", 10)).toEqual([0, 1, 2, 4]);
  });
  it("full range via 'all' is not included - spec strings only", () => {
    expect(() => parsePageSelection("all", 10)).toThrow(PageSelectionError);
  });
  it("rejects zero, reversed, and out-of-range", () => {
    expect(() => parsePageSelection("0", 10)).toThrow(PageSelectionError);
    expect(() => parsePageSelection("3-1", 10)).toThrow(PageSelectionError);
    expect(() => parsePageSelection("11", 10)).toThrow(PageSelectionError);
    expect(() => parsePageSelection("1-99", 10)).toThrow(PageSelectionError);
  });
  it("empty spec throws", () => {
    expect(() => parsePageSelection("", 10)).toThrow(PageSelectionError);
    expect(() => parsePageSelection("  ", 10)).toThrow(PageSelectionError);
  });
  it("rejects non-numeric tokens", () => {
    expect(() => parsePageSelection("1,a", 10)).toThrow(PageSelectionError);
  });
});
