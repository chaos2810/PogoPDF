import { describe, it, expect } from "vitest";
import { validatePageSpec } from "./pagespec";

describe("validatePageSpec", () => {
  it("accepts ranges and mixed selections", () => {
    expect(validatePageSpec("1-3,5")).toBeNull();
    expect(validatePageSpec("8-10")).toBeNull();
    expect(validatePageSpec(" 5, 1-3 , 5 ")).toBeNull();
  });
  it("rejects zero and reversed ranges", () => {
    expect(validatePageSpec("0")).toBe("tool.common.pagesInvalid");
    expect(validatePageSpec("3-1")).toBe("tool.common.pagesInvalid");
  });
  it("rejects non-numeric tokens", () => {
    expect(validatePageSpec("abc")).toBe("tool.common.pagesInvalid");
    expect(validatePageSpec("1,a")).toBe("tool.common.pagesInvalid");
    expect(validatePageSpec("all")).toBe("tool.common.pagesInvalid");
  });
  it("reports an empty selection as required", () => {
    expect(validatePageSpec("")).toBe("tool.common.pagesRequired");
    expect(validatePageSpec("  ")).toBe("tool.common.pagesRequired");
  });
});
