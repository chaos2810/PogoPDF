# PogoPDF Phase 3 (Editor & Forms) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Phase 3 tool set end-to-end: the PDF editor centerpiece (annotate, highlight, redact, draw shapes, add images, text boxes, search), form filler, form creator (drag-drop fields), sign (draw/type/upload), stamps, remove annotations, remove blank pages, remove restrictions, sanitize, bates numbering, and page labels. Plus a cross-phase deliverable recorded here: a **full-app UI review plan** the human executes at the end of all phases.

**Architecture:** The editor is a new interactive screen type: a full-window pdf.js canvas with per-page annotation overlays (a normalized annotation model shared via contracts, rendered with pdf-lib on save). pdf-lib supports annotation dictionaries (Text, FreeText, Ink, Square, Circle, Line, Stamp, Highlight/Underline/StrikeOut via quadpoints, Redact) plus AcroForm fields (fill: field.setValue; create: form.createTextField etc. - verified in Phase 1 watermark research). Remove-restrictions and sanitize reuse qpdf and pdf-lib respectively. Bates/page-labels stamp text via the existing pagedraw rotation-aware drawing. A shared ToolFrame refactor lands first (Task 0) so the 14 new screens compose instead of copy.

**Tech Stack:** pdf.js (canvas render at zoom, text-layer extraction for search), pdf-lib (annotations, forms, drawing), qpdf (restrictions removal, flatten-as-needed), existing sharp/ocr infra untouched. All license-clean (Apache/MIT).

## Global Constraints

- Windows 10/11 x64; Node >= 22.13; no dash punctuation in any text; i18n en + zh-TW parity; both visual gates on every UI change; typed errors; commit style per AGENTS.md.
- Editor interaction model: one page visible at a time (page nav: prev/next, page input, jump-to from thumbnail strip); zoom 25-400%; annotation types via a left tool rail. Mouse only for v1 (pointer events from organize; keyboard a11y as stretch).
- Annotation persistence: the editor builds a normalized model (contracts schema) -> save writes real PDF annotations via pdf-lib so outputs open in any viewer. Editor sessions do NOT live-reload a saved file; save = one job.
- Redaction is two-step by design (mark -> apply) because true redaction must remove the underlying content: apply re-renders the redact rectangles as opaque fills over the page content flattened to an image (existing rasterize infra) - the only honest way to guarantee content removal without PyMuPDF (Phase 4 will upgrade to true content removal).
- The 6 ToolFrame-extracted screens (Task 0) must produce byte-identical screenshots (the 67-state gate is the regression check).

---

### Task 0: Shared screen chrome extraction (the reviewer's canary)

**Files:**
- Create `ui/src/tools/ToolFrame.tsx` (owns dropzone, queue cards, running card, error card, settle chrome)
- Modify `ui/src/tools/FileToolScreen.tsx`, `DataToolScreen.tsx`, `richcontent/EditBookmarksScreen.tsx` to compose it
- Test: existing suites; shots regression

**Steps:**
- [ ] Extract the duplicated shell from the three screens (EditBookmarksScreen is the 262-line canary) into ToolFrame with slots (pick content, options, settle/result)
- [ ] All testids preserved; behavior identical
- [ ] Gates: ui tests, typecheck, shots 67/67 allPass, build + mock absent
- [ ] Commit:
```
Extract the shared tool screen chrome

- ToolFrame owns dropzone, queue, running, and error chrome with
  slots for pick content, options, and settle
- FileToolScreen, DataToolScreen, and the bookmarks editor compose it
  instead of duplicating it
```

### Task 1: Contracts - annotations, editor session, forms, stamps

**Schemas (.strict(), one accept + one reject each):**
- `AnnotationSchema` (recursive-safe union, exported): `{ type: "text"|"highlight"|"underline"|"strikeout"|"rect"|"ellipse"|"line"|"arrow"|"freehand"|"redact"|"image"|"freetext", page: int >= 1, color: "#hex" default "#DC2626", opacity?: 0.05..1 default 1, lineWidth?: 0.5..12 default 2, rect?: {x, y, w, h} (PDF points, origin bottom-left, from the page's displayed box), points?: [{x, y}] (freehand, min 2), text?: string (text/freetext content; WinAnsi-only enforced at engine like all page-drawn text), imagePath?: string (image annotations), fontSize?: default 14 (freetext) }`
- `EditorSaveInputSchema { filePath: string, annotations: AnnotationSchema[] min 1 max 1000 }` - tool id `editorSave`
- `SearchInputSchema { filePath: string, query: string min 1 max 200 }` - DataResult { matches: [{ page, snippet, x, y }] max 500 } - tool id `search`
- `FormFieldsInputSchema { filePath: string }` - DataResult { fields: [{ name, type: "text"|"checkbox"|"radio"|"dropdown"|"signature", value?, options?, readOnly: boolean, required: boolean }] } - tool id `formFields`
- `FormFillInputSchema { filePath: string, values: [{ name: string, value: string }] min 1 max 500 }` - tool id `formFill`
- `FormCreateInputSchema { filePath: string, fields: [{ name: string (auto id), label: string, type: "text"|"checkbox"|"dropdown", x: number, y: number, w: default 150, h: default 24, options?: string[] (dropdown) }] min 1 max 200, page: int default 1 }` - tool id `formCreate`
- `SignInputSchema { filePath: string, mode: "draw"|"type"|"image", inkPoints?: [{x,y}] (draw, page-relative 0..1 normalized), text?: string (type; WinAnsi hint), imageFile?: string (image), page: int default 1, x: number, y: number, scale?: 0.1..4 default 1 }` - tool id `sign`
- `StampInputSchema { filePath: string, text: string (WinAnsi), page: int default 1, x: number, y: number, color: "#hex" default "#DC2626", rotate?: -360..360 default 0 }` - tool id `stamp`
- `RemoveAnnotationsInputSchema { filePath: string, types?: string[] (subset of the annotation types; default all) }` - tool id `removeAnnotations`
- `RemoveBlankPagesInputSchema { filePath: string, tolerance?: int 0..100 default 5 (percent of non-background pixels from a 72dpi render) }` - tool id `removeBlankPages`
- `RemoveRestrictionsInputSchema { filePath: string, password?: string }` - tool id `removeRestrictions` (qpdf --decrypt handles owner-password restrictions without knowing it)
- `SanitizeInputSchema { filePath: string, removeMetadata: boolean default true, removeAnnotations: boolean default true, removeAttachments: boolean default true, removeJavaScript: boolean default true, flattenForms: boolean default true }` - tool id `sanitize`
- `BatesNumberInputSchema { filePath: string, position: 8-enum (the pagenumbers positions), format: "n"|"prefix-n"|"n-of-total", prefix?: string (WinAnsi, default empty), startNumber: int min 0 default 1, fontSize?: default 10, margin?: default 28, pages?: string }` - tool id `bates` (distinguishing feature vs pageNumbers: per-file sequential numbering + prefix)
- `PageLabelsInputSchema { filePath: string, style: "decimal"|"roman-upper"|"roman-lower"|"letters-upper"|"letters-lower"|"none", start: int min 1 default 1, prefix?: string (WinAnsi) }` - tool id `pageLabels` - writes the PDF's native page-label number tree
- TOOL_IDS: `editorSave, search, formFields, formFill, formCreate, sign, stamp, removeAnnotations, removeBlankPages, removeRestrictions, sanitize, bates, pageLabels` (13 ids; view-side editor is a screen, not a tool, but editorSave is)

### Task 2: Engine - editor annotations (editorSave)

**Core:** `engine/src/tools/editor/annotations.ts` - map the normalized model to pdf-lib: text -> FreeText annot (or a Text note with popups v1: FreeText visible), highlight/underline/strikeout -> highlight-type annots with quadpoints from the source rects, rect/ellipse/line/arrow -> Square/Circle/Line annots (arrow = line + 2 short line legs), freehand -> Ink annot from points, image -> page.drawImage + (optionally a /Stamp wrapper) v1: image drawn into content at the rect (not an annot dict - honest hint that image marks flatten), redact -> NO annot saved (redaction only applies in the apply-redaction flow), freetext -> FreeText annot. All annotations include /Rect, /C (color), /CA (opacity), /T ("PogoPDF"). Pages are the DISPLAYED frame (rotation-aware like pagedraw).
**Apply-redaction:** separate RPC `editor.applyRedactions { filePath, outputPath }`? NO - single tool: editorSave with annotations INCLUDING redact rects triggers flatten: render each page with redact rects at 150dpi, fill rects opaque black over the raster, rebuild as image PDF (the existing rasterize path with black overlays), keeping non-redact annotations as pdf-lib annots on the rebuilt pages. Schema: redact allowed in annotations; the handler branches when any redact present.
**Tests:** each annotation type -> output loads in pdf-lib, annot dictionaries present with expected /Subtype and geometry; rotated page rect mapping; redact-branch -> text extraction of output is EMPTY for redacted pages; WinAnsi rejection for freetext/text with CJK; cancellation; encrypted typed.

### Task 3: Engine - search + formFields/formFill/formCreate

**search:** pdf.js text items per page; case-insensitive substring; snippet = +-30 chars context; x/y from item transform (displayed frame). Tests: multi-page matches, no-match empty, case-insensitivity.
**formFields:** pdf-lib form enumeration -> name/type/value/options/readOnly/required (checkbox = CheckBox, radio = RadioGroup with options, dropdown = Dropdown). No fields -> DataResult { fields: [] } (the UI shows an empty state, NOT an error).
**formFill:** setValue per name; unknown name -> INVALID_INPUT naming it; checkbox value "true"/"false"; flatten? No (form stays fillable); NeedAppearances set true so viewers regenerate field appearances. Tests: fill text + check a checkbox -> reload -> values read back; unknown field typed error.
**formCreate:** pdf-lib form.create* at page/coords (displayed-frame coords -> PDF space), AcroForm generated. Tests: create text+checkbox+dropdown -> formFields reads them back; coordinates land on the intended page position.

### Task 4: Engine - sign, stamp, removeAnnotations, removeBlankPages

**sign:** draw -> freehand Ink-like path rendered as page content (WinAnsi N/A; the ink is vector strokes); type -> WinAnsi-checked text in a handwriting-ish style (Helvetica oblique v1); image -> loadImageEmbeddable + drawImage at scale. All placed at x/y (displayed frame) on the chosen page. Tests: each mode renders at the right spot on a rotated fixture; type-mode CJK typed error.
**stamp:** pagedraw text at x/y with rotate + color (a thin wrapper over the watermark primitives). Tests: rotation-aware position, color parse.
**removeAnnotations:** strip /Annots from pages (optionally filtered by /Subtype map). Tests: fixture with annots (made by editorSave) -> gone; type filter keeps others.
**removeBlankPages:** 72dpi render, background-similarity heuristic (median edge color as background; non-bg pixel ratio < tolerance% = blank), delete via the existing buildFromPages inverse. Tests: mixed fixture keeps content pages; tolerance boundary; all-blank -> INVALID_INPUT (refuse an empty document).

### Task 5: Engine - removeRestrictions, sanitize, bates, pageLabels

**removeRestrictions:** qpdf --decrypt (owner-password-restricted files decrypt without the password; user-encrypted files need one -> if ENCRYPTED_PDF surfaced, the UI asks). Tests: restricted fixture (protect with allowCopying=false) -> output loads + restrictions gone; user-password file with password -> unlocked.
**sanitize:** orchestrates existing primitives (removeMetadata + removeAnnotations + attachment removal via the name tree + /Names /JavaScript strip + NeedAppearances-flatten via qpdf --flatten). Tests: kitchen-sink fixture (metadata + annot + attachment) -> all gone per each flag.
**bates:** pagenumbers-style drawing with prefix + per-file sequence (single file v1; the format "n"|"prefix-n"|"n-of-total"). Tests: numbering, prefix, page-numbering non-interference (bates counts its own sequence per file).
**pageLabels:** write the PDF page-label number tree (catalog /PageLabels -> number tree: /S style, /St start, /P prefix). Tests: write -> read back via pdf.js page.label; none style resets to unlabeled.

### Task 6: Engine wrap gate
- [ ] All suites green; registry coverage closes (13 new ids); smoke gains an editorSave + formFill case

### Task 7: UI - Editor screen (the centerpiece)

**Files:** `ui/src/tools/editor/EditorScreen.tsx` (+ AnnotationLayer, ToolRail, PageNav, SearchPanel subcomponents), `ui/src/app/editorModel.ts` (normalized annotation state, add/move/resize/delete, drag threshold reuse from organize)
**Behavior:** open a PDF -> full-window canvas (pdf.js render at zoom) + left tool rail (select, pan, text, highlight, underline, strikeout, rect, ellipse, line, arrow, freehand, redact, image, freetext) + top bar (page nav, zoom, search, save). Draw -> creates model items; select tool -> move/resize/delete (resize handles on 8 corners); freetext/image prompt for content via small inline inputs/file pick. Redact rects render semi-opaque black "MARKED FOR REDACTION" style. Save -> editorSave job -> SaveAsBar. Search panel -> results list, click jumps to page. NO undo/redo v1 (delete + re-draw; note in hint).
**Gates:** the editor screen gets visual states in Task 9 (it needs real pdf.js pages - use the blob-backed fixture pattern from organize-grid-real); the 67 existing states regress-green; suites green.
**Commit:**
```
Add the PDF editor screen with annotation overlays

- Tool rail, canvas at zoom, page nav, and search panel
- Normalized annotation model with move, resize, and delete
- Redact marks render as marked-for-redaction until save
```

### Task 8: UI - forms, sign, stamps, and remaining screens

- FormFillScreen (load formFields -> input per type -> formFill; checkbox/radio/dropdown widgets)
- FormCreateScreen (canvas with click-to-place + a fields list panel; v1 positions by click, drag-adjust v1.1 if cheap)
- SignScreen (draw pad canvas -> normalized points; type input; image pick; placement)
- StampScreen (text + position + color)
- RemoveAnnotationsScreen (type checkboxes + hint)
- RemoveBlankPagesScreen (tolerance slider)
- RemoveRestrictionsScreen (password optional + hint on ENCRYPTED_PDF)
- SanitizeScreen (5 checkboxes, all default on + per-flag hint)
- BatesScreen (position radio, format, prefix, start)
- PageLabelsScreen (style select, start, prefix)
- Registry + router + i18n en/zh-TW for all (categories: edit for the editor family, utility for blank-pages/restrictions/sanitize/bates/labels per the design spec)
- Rust: the "any" picker filter already exists for image stamps/signature images; form filler needs no picker
- Gates: suites, typecheck, i18n parity, shots regression

### Task 9: Visual states + vision loop
- New states (min 16): editor-open (blob-backed PDF, tool rail), editor-annotated (text+rect+highlight), editor-redact-marked, editor-selected (resize handles), editor-search-results, formfill-form (text + checkbox + dropdown fields), formfill-filled, formcreate-placed, sign-draw (ink present), sign-type, stamp-form, removeannotations-form, sanitize-form, bates-form, pagelabels-form, removeblank-form
- [ ] STATES + drives + metrics (annotation-rect no-overlap with tool rail; field rows aligned; resize handles positioned)
- [ ] shots exit 0 (~83 states); vision loop until clean

### Task 10: Release + closing gate
- [ ] No new release deps (all pdf-lib/qpdf); build-release unchanged; smoke gains editor + formFill roundtrip
- [ ] npx tauri build green; headless verification; no zombies
- [ ] Full suites + both gates + closing-gate ledger entry

---

# Full-App UI Review Plan (end of all phases - for the human)

**Purpose:** after Phase 4, one complete human pass over the shipped app, backed by the harness. Budget: ~45 minutes.

**Part 1 - Automated baselines (run these first, ~5 min):**
1. `npm run shots` -> confirm exit 0 and note the final state count (should be ~110+)
2. Read `ui/screenshots/report.json` -> all invariants pass
3. Vision-review the fresh matrix via a subagent with `.superpowers/sdd/visual-audit-brief.md` (the controller does this; you read the findings)

**Part 2 - Install the real thing (~5 min):**
1. Install from `src-tauri/target/release/bundle/msi/` (or NSIS)
2. Launch from the Start Menu; confirm: splash -> main handoff, dark/light per system, en/zh-TW switch

**Part 3 - The golden path walkthrough (~15 min), one representative tool per category:**
- Organize: merge 3 PDFs (drag-drop + picker) -> Save As; then organize-grid: reorder + rotate + delete -> save
- Convert out: PDF to images (webp, dpi 300) -> Save All multi
- Convert in: a docx via officeToPdf (fidelity check vs Word); an image set -> imagesToPdf
- Edit: page numbers (n-of-total, skip first); the editor: highlight a passage, add a freetext note, mark a redaction -> save -> confirm the redacted content is gone (text search finds nothing)
- Secure: protect with password -> try opening it; unlock it back
- Utility: OCR a scanned page (eng) -> confirm the text layer is selectable; compare two versions of a PDF
- Phase 4 spot-checks: PDF/A convert one file; in-place text edit one line; vector SVG export opens in a browser

**Part 4 - Destructive/edge cases (~10 min):**
- Encrypted PDF onto any tool -> typed clean error, not a crash
- Corrupt file (truncate a PDF) -> typed error
- Cancel a long job (large merge) mid-run -> returns to pick state
- Close the app mid-office-conversion -> reopen -> no soffice/engine processes in Task Manager
- Wipe `%LOCALAPPDATA%\PogoPDF\bin` -> cold boot timing feels acceptable (~14s with splash)

**Part 5 - The judgment calls only you can make:**
- Splash: does the ~200ms black flash before the splash bother you?
- Theme: light + dark both feel finished?
- zh-TW: switch language; anything awkwardly translated?
- Editor: does v1's no-undo feel acceptable or blocking?
- Overall: would you ship this to a friend?

**Output:** note findings as { area, severity, issue, suggestion }; critical/important items become fix tasks before the 1.0 tag; minors go to the backlog.