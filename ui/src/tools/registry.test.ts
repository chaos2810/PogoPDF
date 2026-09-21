import { describe, it, expect } from "vitest";
import { TOOL_IDS } from "@pogopdf/contracts";
import { registry } from "./registry";

// xpsToPdf is registered in the engine but hidden from the UI: the official
// mupdf wasm build cannot convert XPS, so there is no honest screen for it. The
// engine registry test still proves the tool exists; this test excludes it here
// so the UI catalog does not promise a feature that cannot work.
const HIDDEN_FROM_UI = new Set<string>([TOOL_IDS.xpsToPdf]);

// Ids that are UI-internal by design: `search` is the editor screen's built-in
// panel, so it has no tool card and Task 8 will never add one. Like
// HIDDEN_FROM_UI this is permanent, not a pending screen.
const UI_INTERNAL = new Set<string>([TOOL_IDS.search]);

// The remaining Phase 3 engine ids (forms, sign, stamps, cleanup) have no UI
// screen yet; Task 8 adds them and this set shrinks to empty. Listing them here
// keeps the coverage check strict without pretending the UI ships screens that
// do not exist.
const PENDING_UI = new Set<string>([
  TOOL_IDS.formFields,
  TOOL_IDS.formFill,
  TOOL_IDS.formCreate,
  TOOL_IDS.sign,
  TOOL_IDS.stamp,
  TOOL_IDS.removeAnnotations,
  TOOL_IDS.removeBlankPages,
  TOOL_IDS.removeRestrictions,
  TOOL_IDS.sanitize,
  TOOL_IDS.bates,
  TOOL_IDS.pageLabels,
]);

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
    const expected = Object.values(TOOL_IDS).filter(
      (id) => !HIDDEN_FROM_UI.has(id) && !UI_INTERNAL.has(id) && !PENDING_UI.has(id)
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
