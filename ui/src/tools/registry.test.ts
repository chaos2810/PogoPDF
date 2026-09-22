import { describe, it, expect } from "vitest";
import { TOOL_IDS } from "@pogopdf/contracts";
import { registry } from "./registry";

// xpsToPdf is registered in the engine but hidden from the UI: the official
// mupdf wasm build cannot convert XPS, so there is no honest screen for it. The
// engine registry test still proves the tool exists; this test excludes it here
// so the UI catalog does not promise a feature that cannot work.
const HIDDEN_FROM_UI = new Set<string>([TOOL_IDS.xpsToPdf]);

// Ids that are UI-internal by design: `search` is the editor screen's built-in
// panel, and `formFields` is the form filler's auto-load RPC (it reads the field
// list so the screen can render a typed input per field). Neither is a user
// action on its own, so neither has a tool card. Like HIDDEN_FROM_UI this is
// permanent, not a pending screen.
const UI_INTERNAL = new Set<string>([TOOL_IDS.search, TOOL_IDS.formFields]);

// Engine ids whose UI screen has not landed yet. editText ships in the engine
// (Phase 4 Task 2); its editor text-edit mode lands in Task 8, so it is listed
// here rather than weakening the coverage check. pdfToPdfA and fontOutline ship
// in the engine at Task 3 and get their screens in Task 8 as well. The image-ops
// suite ships in the engine at Task 4 and likewise gets its screens in Task 8.
// overlay and workflow ship in the engine at Task 5; both get screens in Task 8.
// digitalSign, validateSignature and timestamp ship in the engine at Task 6 and
// get their screens in Task 8 too.
const PENDING_UI = new Set<string>([
  TOOL_IDS.editText,
  TOOL_IDS.pdfToPdfA,
  TOOL_IDS.fontOutline,
  TOOL_IDS.deskew,
  TOOL_IDS.scannerEffect,
  TOOL_IDS.adjustColors,
  TOOL_IDS.invertColors,
  TOOL_IDS.posterize,
  TOOL_IDS.backgroundColor,
  TOOL_IDS.changeTextColor,
  TOOL_IDS.overlay,
  TOOL_IDS.workflow,
  TOOL_IDS.digitalSign,
  TOOL_IDS.validateSignature,
  TOOL_IDS.timestamp,
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
