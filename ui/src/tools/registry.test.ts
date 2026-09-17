import { describe, it, expect } from "vitest";
import { TOOL_IDS } from "@pogopdf/contracts";
import { registry } from "./registry";

// xpsToPdf is registered in the engine but hidden from the UI: the official
// mupdf wasm build cannot convert XPS, so there is no honest screen for it. The
// engine registry test still proves the tool exists; this test excludes it here
// so the UI catalog does not promise a feature that cannot work.
const HIDDEN_FROM_UI = new Set<string>([TOOL_IDS.xpsToPdf]);

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
    const expected = Object.values(TOOL_IDS).filter((id) => !HIDDEN_FROM_UI.has(id));
    expect(expected.filter((id) => !registered.has(id))).toEqual([]);
    expect(registry.map((t) => t.id).filter((id) => !known.has(id))).toEqual([]);
  });
  it("does not surface a screen for the hidden xpsToPdf id", () => {
    expect(registry.some((t) => t.id === TOOL_IDS.xpsToPdf)).toBe(false);
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
