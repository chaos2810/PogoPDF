import { describe, it, expect } from "vitest";
import { TOOL_IDS } from "@pogopdf/contracts";
import { registry } from "./registry";

describe("registry", () => {
  it("has unique ids", () => {
    const ids = registry.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("merge tool exists", () => {
    expect(registry.some((t) => t.id === "merge")).toBe(true);
  });
  it("covers every tool id", () => {
    const registered = new Set(registry.map((t) => t.id));
    const missing = Object.values(TOOL_IDS).filter((id) => !registered.has(id));
    expect(missing).toEqual([]);
  });
  it("uses only known categories", () => {
    const categories = new Set([
      "organize",
      "convertTo",
      "convertFrom",
      "edit",
      "secure",
      "utility",
    ]);
    expect(registry.every((t) => categories.has(t.category))).toBe(true);
  });
});
