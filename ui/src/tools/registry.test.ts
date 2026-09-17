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
  it("covers exactly the known tool ids, with nothing missing or extra", () => {
    const registered = new Set(registry.map((t) => t.id));
    const known = new Set<string>(Object.values(TOOL_IDS));
    expect(Object.values(TOOL_IDS).filter((id) => !registered.has(id))).toEqual([]);
    expect(registry.map((t) => t.id).filter((id) => !known.has(id))).toEqual([]);
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
