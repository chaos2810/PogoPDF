import { describe, it, expect } from "vitest";
import { TOOL_IDS } from "@pogopdf/contracts";
import { registry } from "./registry";

// xpsToPdf is registered in the engine but hidden from the UI: the official
// mupdf wasm build cannot convert XPS, so there is no honest screen for it. The
// engine registry test still proves the tool exists; this test excludes it here
// so the UI catalog does not promise a feature that cannot work.
const HIDDEN_FROM_UI = new Set<string>([TOOL_IDS.xpsToPdf]);

// Ids that are UI-internal by design: `search` is the editor screen's built-in
// panel, `formFields` is the form filler's auto-load RPC (it reads the field
// list so the screen can render a typed input per field), and `editText` is the
// editor rail's in-place text edit (it has no card of its own: it runs from the
// editor screen). None is a user action on its own, so none has a tool card.
// Like HIDDEN_FROM_UI this is permanent, not a pending screen.
const UI_INTERNAL = new Set<string>([TOOL_IDS.search, TOOL_IDS.formFields, TOOL_IDS.editText]);

describe("registry", () => {
  it("has unique ids", () => {
    const ids = registry.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("merge tool exists", () => {
    expect(registry.some((t) => t.id === "merge")).toBe(true);
  });
  // Every engine tool now has a UI surface: the Phase 4 pending list is empty,
  // so the coverage check is once again the plain "all ids minus the two
  // permanent exclusions" set. A reintroduced pending list belongs here.
  it("covers exactly the known tool ids, with nothing missing or extra", () => {
    const registered = new Set(registry.map((t) => t.id));
    const known = new Set<string>(Object.values(TOOL_IDS));
    const expected = Object.values(TOOL_IDS).filter(
      (id) => !HIDDEN_FROM_UI.has(id) && !UI_INTERNAL.has(id)
    );
    expect(expected.filter((id) => !registered.has(id))).toEqual([]);
    expect(registry.map((t) => t.id).filter((id) => !known.has(id))).toEqual([]);
  });
  it("registers the editor screen under the editorSave id", () => {
    expect(registry.some((t) => t.id === TOOL_IDS.editorSave)).toBe(true);
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
