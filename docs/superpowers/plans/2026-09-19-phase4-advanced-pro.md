# PogoPDF Phase 4 (Advanced/Pro) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers::executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the PogoPDF catalog with the final 15 tools: in-place text editing (PyMuPDF WASM), PDF/A conversion and font-to-outline (Ghostscript), the image-op suite (deskew, scanner effect, adjust colors, invert, posterize, background color, change text color), overlay/underlay, digital signatures (create, validate, timestamp), and the workflow builder (visual pipelines).

**Architecture:** Three new capability modules: (1) `engine/src/tools/textedit/` on `@bentopdf/pymupdf-wasm` (Pyodide; the highest-risk integration - prototyped FIRST in Task 1 before any dependent work); (2) `engine/src/tools/ghostscript/` spawning the official `gswin64c.exe` CLI (the qpdf pattern; fetch script + staging + typed errors); (3) `engine/src/tools/sign/` on the pure-JS `@signpdf` + `node-forge` + `pkijs` stack (bundled, not staged). Image ops reuse the shipped mupdf Pixmap + sharp (zero new deps). Overlay/underlay and the workflow builder are pure pdf-lib + existing-registry work. All engines are AGPL-3.0; notices land in the same commits they ship in.

**Tech Stack:** `@bentopdf/pymupdf-wasm` 0.11.16 (AGPL-3.0-only, ~54 MiB staged), Ghostscript 10.08.0 CLI (AGPL-3.0, ~65 MiB staged trimmed), `@signpdf/{placeholder-pdf-lib,signer-p12,signpdf}` + `node-forge` + `pkijs` (MIT/BSD, ~2 MiB bundled), existing mupdf/sharp/pdf-lib/qpdf.

## Global Constraints

- Windows 10/11 x64; Node >= 22.13; no dash punctuation in any text; i18n en + zh-TW parity; both visual gates on every UI change; typed errors; commit style per AGENTS.md; author chaos2810.
- AGPL notices in the same commit an engine first lands (THIRD-PARTY-NOTICES.md rows: pymupdf-wasm incl Pyodide wheels note; Ghostscript incl the AGPL text accompanying the binary; @signpdf/forge/pkijs rows).
- PyMuPDF-WASM is gated on the Task 1 prototype: if Pyodide cannot load in the dev/SEA context, in-place text edit becomes redact+insert at a coarser granularity via the shipped mupdf (fallback documented), NOT a silent scope cut.
- Ghostscript extraction: 7z is not guaranteed on clean machines; the fetch script stages a pinned 7zr.exe from the official 7-Zip site (unRAR license permits), or falls back to NSIS silent install /S /D=. Decide at implementation; document.
- Signature validate scope: structural CMS verification + chain display against a user-supplied trust store (.p7b/.pem/.cer chain). NOT online revocation (documented honestly in the UI hint).
- Text edit scope: click a text line -> edit -> refit the line's box (font size auto-shrink to fit the original quad width). NOT paragraph reflow (documented).
- Release tar grows ~+120 MiB raw (pymupdf-wasm ~54 + gs ~65): record exact numbers at Task 11; the user approved embedding (Option A stands) but the delta is reported.

---

### Task 1: PyMuPDF-WASM integration prototype (the highest-risk item)

**Files:**
- Create `engine/src/textedit/pymupdf.ts` (loader + shim + the edit operations)
- Create `engine/scripts/fetch-pymupdf.mjs`? NO: npm package; vendor via node_modules staging like mupdf (it is --external + staged per the existing pattern)
- Test `engine/src/textedit/pymupdf.test.ts` (skipIf the package fails to load - a loud typed skip, not a silent one)

**Steps:**
- [ ] Install `@bentopdf/pymupdf-wasm@0.11.16`. PROTOTYPE first: load it in a plain node script - `loadPyodide({ indexURL: assetPath })` pointing at `node_modules/@bentopdf/pymupdf-wasm/dist/assets/` (verify the actual layout at implementation; the research says assetPath is configurable), shim the Blob input (`new Blob([bytes])`), run: load a fixture PDF -> getText('words') -> addRedaction on a word quad -> applyRedactions -> insertText at the quad origin with the same font size -> save -> verify with pdf-lib: old word gone from extraction, new word present at the right position
- [ ] If the prototype works: wrap as `engine/src/textedit/pymupdf.ts` exposing `editTextLine(path, edits: [{page, wordIndex | quad, newText}])`. If it FAILS: report BLOCKED with the exact error; the fallback (mupdf redact + Text.showString overlay) is a controller decision, not a silent substitution
- [ ] Tests: the prototype scenario as a real test (load latency tolerated: the suite may need a generous timeout - document the cold-start cost); typed skip with a loud note if assets are absent
- [ ] Verify `npm run build -w @pogopdf/engine` (mark --external like mupdf; build-release staging picks it up via the deps walk - VERIFY the Pyodide assets directory gets staged whole: the wheels + wasm are not in package.json deps, they are dist assets - the staging BFS may miss them; fix the staging explicitly if so)
- [ ] Commit:
```
Add the PyMuPDF wasm text-edit integration

- Pyodide loads from the staged assets; edits are redact-then-
  insert per word quad with font-size autofit
- AGPL notice row lands with the engine
```

### Task 2: In-place text edit tool (editText) + StructuredText UI feed

**Files:**
- Contracts: `EditTextInputSchema { filePath: string, edits: [{ page: int >=1, quad: {x,y,w,h}, newText: string (WinAnsi-checked? PyMuPDF handles unicode - verify; if CJK inserts work, NO Latin-1 limit here; document what's true) }] min 1 max 200 }` + TOOL_IDS `editText`
- `engine/src/tools/textedit/edittext.ts` (runEditText): per edit: hit-test the quad against the loaded word list (the UI supplies the exact quad from a click); addRedaction(quad) + applyRedactions + insertText(quadOrigin, newText, fontsize auto-shrunk to fit quad width); save "edited.pdf"
- `engine/src/tools/textedit/register-textedit.ts` + registry
- Tests: single-word edit (fixture with known text); multi-edit across pages; CJK insert roundtrip (verify honestly - PyMuPDF bundles CJK fonts); font-size autofit (long replacement shrinks); encrypted typed
- [ ] Commit + registry delta noted (68/68)

### Task 3: Ghostscript integration (pdftoa + fontOutline)

**Files:**
- `engine/scripts/fetch-ghostscript.ps1`: download the official `gs10080w64.exe` (10.08.0); extract with a pinned 7zr.exe (staged from 7-zip.org) or NSIS /S /D= (decide + document); stage trimmed to `engine/gs-bin/` (bin + lib + Resource + iccprofiles; drop doc/ ~22.6MB + examples/); print version + sha256; AGPL COPYING file kept in gs-bin (the notice references it)
- `engine/src/tools/ghostscript/gsbin.ts` (resolveGswin + runGs(args, outDir) typed wrapper - the qpdfbin pattern; --version NEVER hangs unlike soffice? verify once)
- `engine/src/tools/ghostscript/pdftoa.ts` (runPdfToPdfA): `gswin64c -dPDFA=2 -dPDFACompatibilityPolicy=1 -sColorConversionStrategy=RGB -sDEVICE=pdfwrite -dNOPAUSE -dBATCH out.pdf in.pdf` -> "pdfa.pdf"; VERIFY the output passes a PDF/A check (veraPDF? no - qpdf --check or the pdf.js load + manual /OutputIntent assertion; document the verification level honestly)
- `engine/src/tools/ghostscript/fontoutline.ts` (runFontOutline): same + `-dNoOutputFonts`; assert text still renders (extractable? outline text is NOT extractable - assert the pages render non-blank and fonts are GONE from resources)
- Contracts: `PdfToPdfAInputSchema { filePath, pdfaVersion: "1b"|"2b"|"3b" default "2b" }`, `FontOutlineInputSchema { filePath }` + TOOL_IDS `pdfToPdfA, fontOutline`
- register + tests (skipIf gs absent): PDF/A out (loads; the -dPDFA=2 with the policy flag; assert /OutputIntent present); font-outline out (fonts gone from the page /Resources; render non-blank); gs version print once in the fetch script only
- [ ] Commit; notices row for Ghostscript in the same commit

### Task 4: Image ops suite (7 tools on mupdf+sharp, zero new deps)

**Files:** contracts + `engine/src/tools/imageops/` (one module per tool, shared raster helpers):
- `deskew.ts`: 72dpi grayscale raster -> pure-JS projection-profile angle detection (candidate angles -7.5..7.5 step 0.5; row-ink-variance maximized; pick best) -> mupdf Matrix.rotate(-angle) re-render or sharp.rotate -> rebuild pages at displayed dims; `DeskewInputSchema { filePath }`; tests: a synthetically rotated 3deg fixture -> output within 0.5deg of upright (assert via the same projection profile); horizontal fixture unchanged; progress/cancel
- `scanner.ts` (scanner effect): sharp modulate + greyscale + contrast + noise? sharp has no noise - add grain via a small LUT over raw pixels; presets: "bw"|"gray"|"faded"; `ScannerEffectInputSchema { filePath, preset: bw|gray|faded default gray }`; tests: color fixture -> gray output (pixel sample); each preset differs
- `adjustcolors.ts`: sharp linear (brightness/contrast) + modulate (saturation) + gamma; `AdjustColorsInputSchema { filePath, brightness: -100..100 default 0, contrast: -100..100 default 0, saturation: -100..100 default 0, gamma: 0.1..3 default 1 }`; tests: brightness shifts luma measurably
- `invertcolors.ts`: mupdf Pixmap.invertLuminance per page (per-page raster; keep page count/sizes); `InvertColorsInputSchema { filePath }`; tests: black becomes white (pixel)
- `posterize.ts`: LUT quantization over mupdf getPixels (levels 2..32); `PosterizeInputSchema { filePath, levels: int 2..32 default 4 }`; tests: unique color count drops <= levels
- `bgcolor.ts`: set the page background (draw a filled rect under content: rebuild each page as image + bg rect, or pdf-lib insert a rect at z-bottom? CONTENTS prepend is hard in pdf-lib - use the raster path: render, fill the canvas bg first, re-embed); `BackgroundColorInputSchema { filePath, color: "#hex default #FFFFFF" }`; tests: corner pixel is the new bg
- `textcolor.ts`: change text color = raster path (render with mupdf StructuredText? the honest v1: render page -> the text pixels tinted? NO - simplest honest: raster the page, recolor via tint() LUT targeting the dark pixels); tests: document the approximation honestly (this is the weakest tool; the hint says approximate recolor)
- register-imageops + tests; TOOL_IDS +7 (75/75)
- [ ] Commit:
```
Add deskew, scanner effect, color, and posterize tools

- Pure-JS projection-profile deskew; mupdf Pixmap and sharp drive
  the color and effect suite
- Background fill, luminance inversion, and level quantization
  with per-page raster rebuild at displayed dimensions
```

### Task 5: Overlay/underlay + workflow builder (engine)

**Files:**
- `overlay.ts`: `OverlayInputSchema { baseFilePath, overlayFilePath, mode: overlay|underlay, opacity? 0.05..1 default 1, scaleToFit?: bool default false }`; pdf-lib embedPage composition (draw order = z-order); rotation-aware; tests: overlay on rotated; underlay beneath visible content; opacity
- `workflow.ts`: `WorkflowInputSchema { steps: [{ toolId (enum of the registry ids? verify the registry covers what a step needs), input }] min 1 max 20 }` -> execute sequentially via the registry's run functions (in-process; no re-dispatch), threading output path into the next step's filePath (the step's input MAY reference `{ "$fromPrevious": true }` on the filePath field - design the threading contract + tests: merge -> rotate chain); progress per step; cancellation between steps; the result = last step's output
- Contracts + register + tests; TOOL_IDS +2 (77/77)
- [ ] Commit:
```
Add overlay, underlay, and workflow pipeline tools

- pdf-lib page composition with z-order and rotation-aware placement
- Workflows chain tool invocations in-process, threading outputs,
  with per-step progress and between-step cancellation
```

### Task 6: Digital signatures (create, validate, timestamp)

**Files:**
- Install `@signpdf/placeholder-pdf-lib@3.3.0`, `@signpdf/signer-p12`, `@signpdf/signpdf`, `@signpdf/utils`, `node-forge@1.4.0`, `pkijs@3.4.1`, `@peculiar/webcrypto` (all bundled, ~2 MiB)
- `engine/src/tools/sign/sign.ts` (runSignCert): pdflibAddPlaceholder + P12Signer (p12 path + passphrase) + signpdf.sign -> "signed.pdf"; `DigitalSignInputSchema { filePath, p12Path: string, passphrase: string, name?, reason?, location? }` (password-file discipline: the passphrase transits RPC - document; p12 read from disk)
- `validatesign.ts` (runValidateSignature): pkijs SignedData verify + cert extraction; `ValidateSignatureInputSchema { filePath, trustStorePath?: string (.pem chain) }` -> DataResult { valid: boolean, signer: { subject, issuer, serial, notAfter }, reason?: string }; honest scope: structural CMS + chain display; no revocation
- `timestamp.ts` (runTimestamp): pkijs TimeStampReq -> POST to the TSA URL -> embed as unsigned attr; `TimestampInputSchema { filePath, tsaUrl: string url }`; NOTE: an RFC 3161 TSA is a NETWORK call - this violates "fully offline"? The design spec lists it; document honestly (the hint says it contacts the TSA server only); tests use a mock TSA (a local http server in the test asserting the request shape)
- register + tests (fixtures: a self-signed p12 generated in-test via node-forge; sign -> validate roundtrip green; tampered byte -> validate false; timestamp against the mock TSA)
- [ ] Commit; notices rows; registry 80/80

### Task 7: Engine wrap gate + smoke
- [ ] Full suite green (registry 80/80); engine build green with the new externals staged (pymupdf-wasm assets!); smoke gains a pdftoa case (gs gated) + an overlay case
- [ ] Commit smoke cases

### Task 8: UI screens (12 new + editor text-edit mode)
- [ ] The editor gains the text-edit tool: click a text run with the Select/EditText tool -> a small inline editor prefilled with the run's text -> on save runs editText with the quad; the rail icon (TextCursorInput? use Type); i18n keys
- [ ] 11 ToolFrame screens: PdfToPdfAScreen (version select), FontOutlineScreen (bare), DeskewScreen (bare + hint), ScannerEffectScreen (preset select), AdjustColorsScreen (4 numbers), InvertColorsScreen (bare), PosterizeScreen (levels), BackgroundColorScreen (color picker input - a hex TextInput validated), TextColorScreen (color + approximation hint), OverlayScreen (TWO file pickers: base + overlay; mode radio), WorkflowBuilderScreen (a visual step list: add step -> tool select + that tool's minimal input fields - a SIMPLE JSON-driven step editor, not a canvas; document v1), SignCertScreen (p12 any-picker + passphrase (type password) + name/reason/location), ValidateSignatureScreen (DataToolScreen rendering the cert result), TimestampScreen (tsaUrl input + the network hint)
- [ ] Registry + i18n en/zh-TW for all; icons verified
- [ ] Gates: ui tests + typecheck + i18n; shots 85-state regression
- [ ] Commit(s)

### Task 9: Visual states + vision loop
- New states (~14): textedit-open (editor with the text tool + a run clicked inline editor), pdftoa-form, fontoutline-form, deskew-form, scanner-form, colors-form, invert-form, posterize-form, bgcolor-form, textcolor-form, overlay-form, workflow-form, signcert-form, validate-view (canned cert result), timestamp-form
- [ ] STATES + drives + metrics; shots ~99 states; harness fixes
- [ ] Vision loop (2 batches) until clean

### Task 10: Release + closing gate + notices
- [ ] build-release.ps1: stage gs-bin (like lo-bin) + pymupdf-wasm assets (VERIFY the Pyodide wheels staged); smoke-release gains pdftoa + sign roundtrip (gs/p12 gated); record the tar/exe size delta (~+120 MiB raw)
- [ ] npx tauri build; headless verification (launch timing + zombies)
- [ ] Full suites + both visual gates + notices complete
- [ ] Closing-gate ledger entry; present the size delta to the user

---

## Self-Review

**Spec coverage:** the design spec's Phase 4 list: in-place text editing (PyMuPDF), PDF/A + font-to-outline (Ghostscript), deskew, scanner effect, adjust colors, invert, background color, change text color, posterize, overlay/underlay, digital signature (X.509), validate signature, timestamp, workflow builder = 15 tools -> this plan's TOOL_IDS additions: editText, pdfToPdfA, fontOutline, deskew, scannerEffect, adjustColors, invertColors, posterize, backgroundColor, changeTextColor, overlay, workflow, digitalSign, validateSignature, timestamp = 15. Registry 67 + 15 = 82.

**Risk register:** pymupdf-wasm-in-SEA is the #1 risk (Task 1 gates it); gs extraction needs the 7zr decision; text-color is the weakest tool (raster approximation, honest hint); timestamp is the only network-touching tool (hinted); signature passphrase transits RPC (documented - the same as protect's passwords).

**Placeholder scan:** all DECIDE points carry verification steps.

**Type consistency:** TOOL_IDS values = keys; contracts consumed verbatim; the workflow step threading contract is defined in Task 5.