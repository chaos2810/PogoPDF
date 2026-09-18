# PogoPDF Phase 2 (Office & Rich Content) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Phase 2 tool set end-to-end: office conversion (Word/Excel/PowerPoint + ODF formats to PDF via LibreOffice headless), rich-content conversion (EPUB/XPS/CBZ/FB2/images to PDF via mupdf), OCR (tesseract.js with searchable-PDF output), table extraction (CSV/JSON/Markdown), PDF to Markdown, prepare-for-AI JSON, attachments (add/extract/edit), bookmarks editor, and TOC generation.

**Architecture:** Two new engine capability modules join the established spine: (1) `engine/src/tools/office/libreoffice.ts` - a spawned-CLI wrapper around `soffice.exe` following the qpdf pattern (env override, staged-path resolution, per-job profile isolation via `-env:UserInstallation`, typed errors, windowsHide); LibreOffice is fetched by script for dev and staged whole into the release deps like qpdf. (2) `engine/src/render/mupdfengine.ts` - the mupdf npm wasm binding (AGPL) for EPUB/XPS/FB2 document opening and rich rendering. tesseract.js (Apache-2.0) provides OCR against rasterized pages from the existing pdf.js renderer. Attachments and bookmarks are pure pdf-lib operations. All tools register on the existing contract; UI screens ride the shared shells; every tool gets visual states per AGENTS.md.

**Tech Stack:** LibreOffice headless (MPL-2.0, researched verdict: best FOSS fidelity, Secondary-License compatible with AGPL), mupdf 1.28.1 npm (AGPL-3.0-or-later), tesseract.js 7 (Apache-2.0), pdf-lib/pdf.js/sharp (existing), jszip (existing, attachments).

## Global Constraints

- Windows 10/11 x64; Node >= 22.13.
- LICENSE is AGPL-3.0; mupdf is the first AGPL engine to land - THIRD-PARTY-NOTICES must gain its notice in the same commit it's used.
- All strings via @pogopdf/i18n en + zh-TW (parity). No emoji; lucide icons. No dash punctuation in any text (use periods).
- Every UI change passes BOTH visual gates (npm run shots exit 0 + controller-dispatched vision review).
- Engine spine: contracts schema -> engine module (registered with schema; bootstrap validates) -> UI screen -> visual states. Typed errors via TOOL_ERROR_CODES. Multi-output via MultiFileResult; data results via DataResult.
- LibreOffice integration rules: spawn `soffice --headless --norestore --nolockcheck --nodefault --convert-to <filter> --outdir <dir> -env:UserInstallation=file:///<job-profile-dir> <input>`; the per-job profile dir lives inside the job's temp workspace (cleaned by the existing exit-time cleanup); verify no soffice process outlives the engine (zombie invariant extends to soffice); the tool waits for conversion completion (soffice exits when done).
- mupdf npm: pure-JS/WASM AGPL binding - bundles into the SEA cleanly (no natives); verify at Task 3 with the staged smoke.
- Office/ODF input validation: extension-based; unsupported extension -> typed UNSUPPORTED_FORMAT naming it.
- Engine tests need REAL fixtures: generate .docx/.xlsx/.pptx fixtures via a Node script in dev-deps (officegen or exceljs + docx packages - verify licenses at implementation; they are build-time test-only deps, not shipped) OR use minimal hand-crafted OOXML zip fixtures (a .docx is a zip with document.xml - a hand-built minimal one is ~30 lines and zero new deps; PREFER hand-crafted minimal fixtures + one real-world downloaded fixture set IF the environment allows; document the choice). LibreOffice tests skipIf the binary is absent (fetch script is the prerequisite) - same pattern as qpdf.
- Commit style: no prefix, capital first letter, "- " bullets. Author: repo-local chaos2810.

---

### Task 1: Contracts - Phase 2 schemas

**Files:** Modify `packages/contracts/src/tools.ts`; Test `tools.test.ts`.

**Schemas (all .strict()):**
- `OfficeToPdfInputSchema { filePath: string, format hint not needed - extension drives the LibreOffice filter }` - one schema for ALL office/ODF inputs: `OfficeToPdfInputSchema { filePath: string }` (docx/doc/xlsx/xls/pptx/ppt/odt/ods/odp/odg/rtf)
- `EbookToPdfInputSchema { filePath: string, fontSize?: default 12, margins?: default 72 }` - EPUB/FB2 (mupdf lays out; page size A4)
- `XpsToPdfInputSchema { filePath: string }` - XPS/OXPS
- `ComicToPdfInputSchema { filePath: string }` - CBZ/CBR? CBR needs rar extract - v1 CBZ only (zip of images via jszip; render each entry through the images pipeline); name ComicToPdf to allow CBR later
- `OcrInputSchema { filePath: string, language: "eng" default | "chi_tra" | "jpn" (language codes enum: eng, chi_tra, chi_sim, jpn, kor, deu, fra, spa - the tesseract bundled set), pages?: string, dpi?: 72..600 default 150, searchableOutput: boolean default true }` - searchable=true: OCR text layer placed under the page image (rendered page + invisible text = searchable PDF); false: plain .txt per page (multi-output)
- `ExtractTablesInputSchema { filePath: string, pages?: string, format: "csv" | "json" | "markdown" default csv }` - v1: text-position-based table detection (column clustering via x-gaps between text items from pdf.js extraction); honest hint that it works best on ruled/simple tables
- `PdfToMarkdownInputSchema { filePath: string, pages?: string }` - headings detection v1: font-size heuristics from pdf.js text items (largest font on page -> h1, etc.); honest hint
- `PrepareForAiInputSchema { filePath: string, pages?: string }` - LlamaIndex-style JSON document: { pages: [{ text, page: n }] } + metadata block
- `AddAttachmentsInputSchema { filePath: string, attachments: string[] min 1 max 50 }` - files to embed (paths)
- `ExtractAttachmentsInputSchema { filePath: string }` - multi-output
- `EditAttachmentsInputSchema { filePath: string, removeNames: string[] default [] }` - v1 remove-only (view via extract list? Data result listing embedded files first: DECIDE - run returns DataResult { attachments: [{name, size}] } after removal; the screen shows the before-list via a view step? SIMPLEST: single run returns the edited PDF + the UI can view via viewMetadata-style listing later. Keep: input removeNames; output single edited.pdf)
- `BookmarksDataSchema` (contract type): bookmark tree node { title, page (1-based), children: [] }
- `ViewBookmarksInputSchema { filePath: string }` - DataResult { bookmarks: BookmarkNode[] }
- `EditBookmarksInputSchema { filePath: string, bookmarks: BookmarkNode[] }` - replaces the whole outline (the UI editor is the source of truth after View)
- `TocInputSchema { filePath: string, position: "after-cover" | "beginning" default beginning, title?: string default "Table of Contents" }` - generates a TOC page from the existing outline (requires bookmarks present; typed error if none) and inserts it
- TOOL_IDS additions: `officeToPdf, ebookToPdf, xpsToPdf, comicToPdf, ocr, extractTables, pdfToMarkdown, prepareForAi, addAttachments, extractAttachments, editAttachments, viewBookmarks, editBookmarks, toc` (14 ids)

- [ ] TDD accept/reject per schema (enums, bounds, min/max arrays, language codes, removeNames default) -> green -> commit
```
Add office, rich content, OCR, and attachment contracts

- Office/ODF single-schema input; ebook, XPS, comic inputs
- OCR with language enum and searchable/txt output modes
- Tables, Markdown, AI-JSON extraction schemas
- Attachment add/extract/edit and bookmark view/edit/TOC schemas
```

---

### Task 2: Engine - LibreOffice wrapper + officeToPdf

**Files:**
- Create `engine/scripts/fetch-libreoffice.ps1` (download the official LibreOffice Windows x64 install; extract the program tree - the .msi/.exe installer can be administratively installed to a dir: `msiexec /a` administrative install extracts without installing; stage to `engine/lo-bin/` (soffice.exe at lo-bin/program/soffice.exe); print version + sha256; ~700MB-1GB on disk - lo-bin/ gitignored)
- Create `engine/src/tools/office/libreoffice.ts`: `resolveSoffice()` (env POGOPDF_LO_BIN -> engine/lo-bin/program -> deps-staged cwd path) + `runOfficeConvert(inputPath, outDir, jobId): Promise<string>` - spawn with per-job profile dir inside outDir, `--convert-to pdf:<filter>` filter by extension (docx/doc/rtf/odt -> writer_pdf_Export; xlsx/xls/ods -> calc_pdf_Export; pptx/ppt/odp -> impress_pdf_Export; odg -> draw_pdf_Export), wait exit, locate the produced PDF (LibreOffice names it <basename>.pdf in outdir), map non-zero exit -> CORRUPT_PDF with stderr tail; unsupported extension -> UNSUPPORTED_FORMAT
- Create `engine/src/tools/office/officetopdf.ts` (runOfficeToPdf)
- Create `engine/src/tools/office/register-office.ts`
- Modify `engine/src/tools/registry.ts`, root `.gitignore` (engine/lo-bin/)
- Test `engine/src/tools/office/office.test.ts` (skipIf no soffice; hand-crafted minimal .docx/.xlsx/.pptx fixtures via a fixtures helper `engine/src/testing/ooxml.ts` that zips minimal OOXML; fetch script prerequisite)

**Semantics/tests:**
- .docx fixture (minimal word/document.xml with one paragraph "Hello Office") -> PDF loads via pdf-lib, extracted text (pdf.js) contains "Hello Office"
- .xlsx fixture (one sheet one cell "42") -> extracted contains 42
- .pptx fixture (one slide title) -> extracted contains title
- .odt fixture -> converts (extension path)
- wrong extension (.txt named .docx) -> what does soffice do? honest test: document actual behavior; if soffice converts anyway -> fine, assert output exists; if fails -> typed CORRUPT_PDF
- unsupported extension -> UNSUPPORTED_FORMAT typed
- concurrent-profile isolation: two sequential runs each get fresh profile dirs (assert profile dirs differ / no lock errors)
- soffice process does not linger after run (poll Get-Process during test is awkward - assert the spawn exited via the wrapper's completion)
- cancellation: entry check (conversion is atomic; cannot interrupt soffice mid-run v1 - document; cancel before spawn)
- [ ] Commit
```
Add LibreOffice headless office conversion

- soffice fetched by script; staged like qpdf; per-job profile dirs
- Extension-driven export filters; typed errors; no lingering process
- Minimal OOXML zip fixtures for docx, xlsx, pptx, and odt
```

---

### Task 3: Engine - mupdf module + ebookToPdf/xpsToPdf/comicToPdf

**Files:**
- Create `engine/src/render/mupdfengine.ts`: wrapper over the mupdf npm package - `openDocument(path, kind)` for EPUB/FB2/XPS; mupdf renders laid-out pages; export each page to PDF via mupdf's PDF output device into a new document. READ the mupdf npm README at implementation for the actual wasm API (Document.open, page run through a PDF writer; mupdf-js examples convert xps/epub to PDF by iterating pages into a new pdf document via the built-in PDFDevice/write APIs)
- Create `engine/src/tools/richcontent/ebooktopdf.ts`, `xpstopdf.ts`, `comictopdf.ts` (comic = jszip entries -> images -> existing imagesToPdf pipeline page-per-image, fit mode)
- Create `engine/src/tools/richcontent/register-richcontent.ts` + registry wiring
- Modify `engine/package.json` (+mupdf), THIRD-PARTY-NOTICES.md (mupdf AGPL notice - REQUIRED in the same commit)
- Test `engine/src/tools/richcontent/richcontent.test.ts`: fixtures - craft a minimal EPUB (zip with mimetype + container.xml + one xhtml chapter - hand-built ~40 lines), minimal FB2 (plain XML), minimal XPS? XPS is OPC zip with FixedDocument - hand-build minimal single-page XPS; comic: reuse the zip image fixtures

**Tests:** each format -> output PDF loads, pageCount >= 1, extracted text contains expected string (epub chapter text; fb2 title; comic = image-only pages non-blank render). Encrypted/typed paths not applicable (mupdf open failures -> CORRUPT_PDF).
- [ ] Commit
```
Add EPUB, XPS, FB2, and comic conversion via mupdf

- mupdf wasm opens and relays laid-out pages into PDF output
- AGPL notice added in the same commit the engine first lands
- Hand-built minimal EPUB, FB2, XPS, and comic fixtures
```

---

### Task 4: Engine - OCR (tesseract.js)

**Files:** Create `engine/src/render/ocr.ts` (tesseract worker pool: single worker, langs from schema enum; recognize page PNGs), `engine/src/tools/richcontent/ocr.ts`, register + wiring, `engine/package.json` (+tesseract.js; worker/lang data resolved offline - tesseract.js downloads lang data at first use: vendor the .traineddata files into engine/ocr-data/ via a fetch script `engine/scripts/fetch-ocr-data.ps1` listing the enum langs, ~10-30MB total; worker script resolved from node_modules - staged like the JS externals if needed; VERIFY offline operation in the test by pointing langPath at the staged data), Test.

**Semantics:** searchable=true: for each selected page render@dpi -> tesseract recognize -> build new PDF page: embedded page image + invisible text layer (render mode 3, i.e. invisible: pdf-lib drawText with `renderingMode`? pdf-lib doesn't expose text render mode directly - use the low-level operator push or check drawText options; if unsupported, use pdftoimages-style: image page + text at 0.0 alpha? Alpha 0 text still selects? Honest check: pdf-lib drawText opacity 0 - selectable in most viewers - TEST what actually selects; if neither works use qpdf or embed via content stream ops pushed raw - decide + document). searchable=false: .txt per page (multi-output). Progress per page; cancellation between pages.
**Tests:** fixture PDF with drawn text "Hello OCR World" (standard Helvetica via makePdf drawText) -> searchable output: text extractable from output contains "Hello" (proves the invisible layer); image present (non-blank + has XObject); txt mode: contains the words; pages selection; encrypted typed.
- [ ] Commit
```
Add OCR with searchable-PDF and plain-text outputs

- tesseract.js with vendored language data for fully offline use
- Invisible text layer over rasterized pages makes PDFs selectable
- Per-page progress and cancellation; typed errors
```

---

### Task 5: Engine - extractTables + pdfToMarkdown + prepareForAi

**Files:** Create `engine/src/tools/richcontent/extracttables.ts`, `pdftomarkdown.ts`, `prepareforai.ts`, register + wiring, Test.

**Semantics:**
- extractTables: per selected page: pdf.js text items -> cluster into rows by y-proximity -> within a row, split columns by x-gaps > threshold (1.5x avg char width); output per format: csv (csv-format string per page, multi-output <page-n>.csv), json ({ page, rows: string[][] } array -> single output.json), markdown (pipe tables, single output.md). Empty detection: pages with < 2 columns detected skipped; zero tables total -> typed UNSUPPORTED_FORMAT "No tables detected" (honest hint in UI desc: works best on clean ruled/simple layouts)
- pdfToMarkdown: font-size heuristics: compute body size = mode of item sizes; items >= 1.5x body -> h2, >= 2x -> h1; bold detection v1 skipped (font name contains "Bold" -> ** wrap); paragraphs by y-gaps; lists by bullet glyphs; code blocks skipped v1; single output.md. Hint: approximate structure
- prepareForAi: single output .json { metadata: { pageCount, title? }, pages: [{ page, text }] }
**Tests:** makePdf fixtures with a positioned 3x3 text grid (drawText at computed positions) -> csv rows detected; markdown: fixture with big/small text -> headings; prepareForAi json shape.
- [ ] Commit
```
Add table extraction, Markdown export, and AI JSON export

- Text-position clustering detects rows and columns per page
- Font-size heuristics map headings to Markdown structure
- Honest hints on detection limits in tool descriptions
```

---

### Task 6: Engine - attachments trio

**Files:** Create `engine/src/tools/richcontent/attachments.ts` (add: pdf-lib attach - doc.attach() API exists: verify `PDFDocument.attach(bytes, name)`; extract: read doc.enumerate... find the pdf-lib attachment API (list/extract via low-level Names tree if the high-level API is absent - investigate; pdf-lib has no first-class attachments API; implement via catalog /Names /EmbeddedFiles low-level), edit: remove by name), register + wiring, Test.

**Tests:** add two files -> extract returns them byte-equal; remove one -> gone, other survives; extract from a fixture with none -> typed UNSUPPORTED_FORMAT "No embedded files"; encrypted typed.
- [ ] Commit
```
Add PDF attachment add, extract, and remove tools

- Low-level EmbeddedFiles name-tree implementation over pdf-lib
- Roundtrip fixtures prove byte fidelity; typed empty result
```

---

### Task 7: Engine - bookmarks view/edit + TOC

**Files:** Create `engine/src/tools/richcontent/bookmarks.ts` (view: read outline tree -> BookmarkNode[]; edit: replace whole outline - low-level Outlines dict build), `toc.ts` (generate TOC page from current outline via pdfkit or pdf-lib drawText table: title....... page; insert at position; page numbers 1-based as displayed; update nothing else), register + wiring, Test.

**Tests:** view on fixture with outline (build via low-level or via editBookmarks itself - bootstrap: edit sets outline, view reads it back -> tree equal); TOC: outline of 3 items -> output PDF page 1 contains the 3 titles + numbers (extract); insert position after-cover: fixture where page 1 is a cover (just test both positions page counts); TOC with no bookmarks -> typed INVALID_INPUT "No bookmarks found".
- [ ] Commit
```
Add bookmark viewing, editing, and table of contents

- Low-level outline tree read and replace over pdf-lib
- TOC page generated from the outline with leader dots and numbers
- Typed error when no outline exists
```

---

### Task 8: Engine wrap gate + mupdf AGPL release check

- [ ] All engine suites green (existing 319 + ~40 new); contracts green; typechecks clean
- [ ] `npm run build -w @pogopdf/engine` green (mupdf bundles; jszip/tesseract externals if needed - follow Task 3/4 findings)
- [ ] Smoke: add one office conversion + one mupdf conversion + OCR to smoke-release.mjs (env-gated: office smoke runs only when soffice staged - document)
- [ ] Zombie check: no soffice/tesseract/node lingering after engine exit (extend the verification)

---

### Task 9: UI screens + registry + i18n

**Files:** ui/src/tools/office/OfficeToPdfScreen.tsx (bare FileToolScreen + hint listing supported formats honestly incl. fidelity note), richcontent screens (EbookToPdf, XpsToPdf, ComicToPdf bare-ish + hints; OcrScreen language select + pages + searchable checkbox + dpi; ExtractTablesScreen format radio + pages + hint; PdfToMarkdownScreen pages + hint; PrepareForAiScreen pages; AddAttachmentsScreen multi-pick "attachment files" (any extension - the dialog filter accepts all? add filter "any" to the Rust dialog) + the main PDF pick - TWO pickers on one screen - FileToolScreen takes one file set; DECIDE: the main PDF via the standard drop zone + attachments via a second "Add attachment files" button appending to a SECOND list rendered as simple rows (not cards); document the UX), ExtractAttachmentsScreen (multi Save All), EditAttachmentsScreen (view-list via extract-then-remove flow: pick PDF -> engine extract list shown as rows with remove buttons -> run edits - implement as: run = job that returns DataResult listing? NO - editAttachments is a single job: the screen shows a static empty list pre-run? SIMPLEST HONEST V1: the screen uses extractAttachments' DataResult? extractAttachments returns files not a list... REWORK: editAttachments input gains nothing; screen flow: pick -> "Load list" button runs a NEW light RPC `attachments.list` (engine: enumerate names/sizes -> DataResult) -> rows with remove checkboxes -> CTA runs editAttachments with removeNames. Add `attachments.list` to the engine in Task 6 (one more dispatcher method, not a tool)), ViewBookmarksScreen (DataToolScreen tree render - nested list indentation), EditBookmarksScreen (loads via view, editable tree: v1 flat editing - rows with title + page inputs + delete + add-child? V1 SCOPE: a flat two-level editor: rows for top-level bookmarks each with title + page + optional children count display... DECIDE + document: v1 = flat list editor (title/page/delete/add row); children beyond level 2 preserved? REWORK v1: bookmarks edited as a FLAT list of top-level entries; children flattened in with indent - preserve none. HONEST desc: "replaces the outline with the list you build". Simplest correct), TocScreen (position radio + title input + hint)
- Registry: 14 ToolMeta entries (categories: convertTo for the converters, utility for extract/prepare/attachments/bookmarks/toc... DECIDE: convertTo: officeToPdf, ebookToPdf, xpsToPdf, comicToPdf, ocr; utility: extractTables, pdfToMarkdown, prepareForAi, addAttachments, extractAttachments, editAttachments, viewBookmarks, editBookmarks, toc) + TOOL_SCREENS; verified lucide icons (FileSpreadsheet? Presentation? BookOpen, Newspaper? - verify names at 0.447: FileText family, BookOpen exists, ScanText, Table, Braces, Paperclip, Paperclip minus for remove, Bookmark, ListTree? verify, ListOrdered for TOC)
- i18n en + zh-TW: 14 tools titles/descs + option labels + the honest hints (office fidelity, OCR langs, tables best-case, markdown approximate, attachments any-file, bookmarks replaces outline, TOC requires bookmarks)
- Mock: `attachments.list` data result; ocr/comic/ebook canned results; office conversion auto job

**Gates:** ui tests + typecheck + i18n parity; shots 53 states regression; build + mock absent.
- [ ] Commit
```
Add screens for office, rich content, OCR, and attachment tools

- Fourteen screens on the shared shells with honest capability hints
- Attachment editor lists embedded files before removing
- en and zh-TW strings for every new tool
```

---

### Task 10: Visual states + vision loop

**New states (min 12):** office-form (docx card + formats hint), ebook-form, comic-form, ocr-form (lang select, searchable checked, hint), tables-form, markdown-form (hint), prepareai-form, attachments-add-form (PDF card + attachment rows), attachments-extract-done (Save All rows), attachments-edit-view (loaded list with checkboxes), bookmarks-view (tree data), bookmarks-edit-form (rows), toc-form. + regression 53.
- [ ] STATES + drives + metrics (CTA expectations; rows for attachment/bookmark lists reuse data-row invariants)
- [ ] shots exit 0 (~65 states); fix findings
- [ ] Vision loop: controller dispatches over ALL PNGs; fix real findings; both gates clean

---

### Task 11: Release packing - LibreOffice + mupdf + OCR data + wrap gate

**Files:** build-release.ps1 (stage lo-bin program tree + ocr-data into the deps tar - LO adds ~700MB-1GB raw; zstd-compressed embedded blob grows accordingly - RECORD the final exe size honestly; if the embedded blob exceeds practical single-exe limits (>~500MB compressed), DECIDE + document: keep embedding (single-file goal) vs optional office component fetched on first use - present the size to the user for the call), THIRD-PARTY-NOTICES (LibreOffice MPL block + tesseract data), smoke-release gains office conversion (gated on staged soffice), native-modules.md updated.
- [x] `npx tauri build` green; headless verification incl. office conversion from the installed exe (if embedded) - fresh-cache extraction timing will grow; record
- [ ] Full suites green; visual gates not needed for this task (no UI or engine source changes; the release script, Rust-free) -> Phase 2 complete gate: present the exe-size delta + timing to the user before declaring done

**Task 11 result (Option A: embed everything trimmed).** The user chose to keep
the offline single-exe promise. `build-release.ps1` stages `lo-bin/` to `lo/`
with robocopy exclusions (dict-* extensions, *.mo, help, readmes, gallery):
1504 MB raw to 760 MB staged. The deps tar went from 211 MB to 968 MB; the
zstd-embedded deps blob is 258.5 MB; `pogopdf.exe` is 293.0 MB; installers are
286.5 MB (MSI) and 287.8 MB (NSIS). First launch with a wiped cache spawned the
engine at 13.2 s (the user's required measurement); the second launch reused the
cache in 1.0 s. Both the staged-pair and the extracted installed-layout smoke
runs pass, including a docx converted through the trimmed `lo/` tree with its
text extracted. No zombies, no `.tmp` leftovers.

---

## Self-Review

**Spec coverage:** office (Word/Excel/PowerPoint via LibreOffice, ODF x4, RTF), rich content (EPUB/XPS/CBZ/FB2), OCR, extract tables, PDF to Markdown, prepare-for-AI, attachments x3, bookmarks view/edit, TOC = the full Phase 2 list at ~18 tools (14 new ids + RTF/ODF riding officeToPdf + chi lang variants riding ocr).

**Risk register:** LibreOffice acquisition + size (Task 2 fetch + Task 11 size decision - the plan flags the exe-size call to the user BEFORE completion); mupdf wasm API shape (Task 3 verifies against the real package; honest BLOCK if the npm binding lacks PDF export - fallback would be render-to-image pipeline, document honestly); tesseract offline lang data (vendored, Task 4); OCR invisible-text-layer mechanism (Task 4 investigates pdf-lib render mode; honest verification that text is selectable); attachment/bookmark low-level pdf-lib code (Tasks 6-7, tree walking tested round-trip); EditAttachments UX reworked to a list-first flow via attachments.list (Task 6 adds the RPC).

**Placeholder scan:** DECIDE points all carry concrete defaults + verification steps.

**Type consistency:** OfficeToPdfInputSchema consumed verbatim; BookmarkNode type shared by view/edit contracts; DataResult flows for attachments.list/viewBookmarks/ocr-txt? (ocr txt is multi-output files, not data); TOOL_IDS values = keys; registry-coverage test (from Tools C) will enforce engine registration of all 14 new ids automatically.