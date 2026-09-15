import { describe, it, expect } from "vitest";
import { registry } from "./registry";

describe("registry", () => {
  it("has unique ids", () => {
    const ids = registry.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("merge tool exists", () => {
    expect(registry.some((t) => t.id === "merge")).toBe(true);
  });
});
