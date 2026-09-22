// Generates the vision-review brief for the screenshot harness.
//
// The controller model cannot read images; it dispatches a vision-capable
// subagent that reads every PNG and reports findings. This module owns the
// canonical state list (name + intended state) so screenshots.mjs and a manual
// `node scripts/write-audit-prompt.mjs` agree on what gets reviewed.
//
// Usage: node scripts/write-audit-prompt.mjs   (from ui/, or imported by
// screenshots.mjs via writeAuditBrief()).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(__dirname, "..");
const repoRoot = resolve(uiDir, "..");
const shotsDir = join(uiDir, "screenshots");
const briefPath = join(repoRoot, ".superpowers", "sdd", "visual-audit-brief.md");

// Canonical screenshot matrix. `intent` explains the user-visible state the PNG
// must represent; keep in sync with the capture flow in screenshots.mjs.
export const STATES = [
  { name: "home-light", intent: "Home screen (tool grid) in light theme, nothing selected" },
  { name: "home-dark", intent: "Home screen in dark theme; dark tokens applied" },
  { name: "merge-empty", intent: "Merge tool opened with no files: idle drop zone, CTA disabled" },
  { name: "merge-dragover", intent: "Files hovering over the drop zone, before release (drag feedback)" },
  { name: "merge-files", intent: "Merge tool with 3 short-named PDFs shown as thumbnail cards (preview above, name below), CTA enabled" },
  { name: "merge-longnames", intent: "Merge tool with 3 long (incl. CJK) file names: each name clamps to two lines with an ellipsis; card size unchanged" },
  { name: "merge-many", intent: "Merge tool with 8 thumbnail cards: cards wrap evenly, no tile is resized by its name" },
  { name: "merge-running", intent: "Merge in progress at 62%: progress text + bar" },
  { name: "merge-cancelled", intent: "Merge cancelled by the user: returns to the pick phase with the file list intact (no error card)" },
  { name: "merge-done", intent: "Merge finished: Done label + Save As bar" },
  { name: "merge-error", intent: "Merge failed: error card in danger tone with a Back action" },
  { name: "merge-zhtw", intent: "Merge tool in zh-TW: every UI string translated, CJK renders cleanly" },
  { name: "split-form", intent: "Split tool, 1 file, ranges mode with \"1-3,5\": option form spacing, CTA enabled" },
  { name: "split-invalid", intent: "Split tool, ranges \"abc\": inline validation error shown, CTA visibly disabled" },
  { name: "extract-form", intent: "Extract Pages tool with 1 file and pages \"2-4\": form + CTA" },
  { name: "organize-grid", intent: "Organize Pages grid with 6 numbered page thumbnails: even cells, aligned labels/toolbar" },
  { name: "organize-grid-rotated", intent: "Organize grid after rotating cell 1: cell size unchanged, thumbnail rotation visible" },
  { name: "organize-dragging", intent: "Organize grid mid pointer-drag: lifted cell visually distinct from the hovered target" },
  { name: "organize-grid-real", intent: "Organize grid rendering a real blob-backed 2-page PDF via pdf.js; the header shows a readable file name (not a UUID) and page 2 is /Rotate 90 so it appears portrait-rotated" },
  { name: "rotate-form", intent: "Rotate tool, 1 file, angle 90 + pages \"2-3\": radio row and inputs on one rhythm" },
  { name: "booklet-form", intent: "Booklet tool with 1 file and no options: bare drop zone + CTA card" },
  { name: "nup-form", intent: "N-up tool, 1 file, layout 2x2 + default margin: select and number input aligned" },
  { name: "pdftoimages-form", intent: "PDF to Images, 1 file, format WebP + DPI 300 + quality 90: the conditional Quality field is visible" },
  { name: "pdftotext-form", intent: "PDF to Text, 1 file, pages \"2-3\": single optional-pages field + muted hint" },
  { name: "svg-form", intent: "PDF to SVG, 1 file, DPI 300 + pages \"2\": the raster hint text is readable below the fields" },
  { name: "cbz-form", intent: "PDF to CBZ, 1 file, DPI 300: single-field form spacing" },
  { name: "greyscale-form", intent: "PDF to Greyscale, 1 file, pages \"1-3\": pages field + two muted hints" },
  { name: "fixpagesize-form", intent: "Fix Page Size, 1 file, A4 + portrait + scale: size select, two radio rows and the fit hint on one rhythm" },
  { name: "imagestopdf-form", intent: "Images to PDF with 3 image files queued as picture-preview cards, page size \"Fit to each image\", margin 12: the orientation radios are visibly disabled and the CTA is enabled" },
  { name: "textpdf-form", intent: "Text to PDF with 1 .txt file queued (document placeholder card), font size 14: fields left-aligned and the plain-text hint below" },
  { name: "markdown-form", intent: "Markdown to PDF with 1 .md file queued, font size 12: the simple-rendering hint is visible below the fields" },
  { name: "csvtopdf-form", intent: "CSV to PDF with 1 .csv file queued and Landscape selected: radio row, font size field and table hint share one rhythm" },
  { name: "pagenumbers-form", intent: "Page Numbers with 1 file, position Bottom center, format \"1 / 5\", \"Skip the first page\" ticked: the long radio list, numeric fields and checkbox stay aligned" },
  { name: "watermark-text-form", intent: "Watermark in Text mode: \"CONFIDENTIAL\" entered, opacity and rotation set, position Tile selected, and the Latin-1 limitation hint visible" },
  { name: "watermark-image-form", intent: "Watermark in Image mode with an image chosen: the text-only controls (text, font size, rotation, color, tile) are gone, leaving the image picker, opacity, pages and the image hint" },
  { name: "crop-form", intent: "Crop PDF with insets 10/10/20/20 and an empty pages field: the four numeric insets align in the two-column form with the CTA enabled" },
  { name: "headerfooter-form", intent: "Header & Footer with header \"Quarterly Report\" and footer \"Page\": one shared Latin-1 hint spans the full width below the header/footer pair, so the Font size and Margin rows stay aligned" },
  { name: "editmetadata-form", intent: "Edit Metadata with title and author filled and the subject \"Clear this field\" box ticked: six field groups each pair an input with a clear checkbox" },
  { name: "protect-form", intent: "Protect PDF with the owner password filled and the user password empty: both password inputs render masked dots; Allow printing is ticked, Allow copying is not" },
  { name: "unlock-form", intent: "Unlock PDF with the password filled (masked dots) and the hint text below it" },
  { name: "flatten-form", intent: "Flatten PDF with 1 file queued and no options: the queue card, drop zone, flattening hint and CTA" },
  { name: "removemetadata-form", intent: "Remove Metadata with 1 file queued and no options: the queue card, drop zone, removal hint and CTA" },
  { name: "compare-view", intent: "Compare PDFs result card after comparing 2 files: five label/value rows (differing pages \"2\", an em-dash for the empty size-mismatch list), one aligned label column, the \"flags large visual changes\" similarity hint below the rows, and a Back action" },
  { name: "pdfstozip-form", intent: "PDFs to ZIP with 3 PDF thumbnail cards queued and an enabled CTA (no options)" },
  { name: "rasterize-form", intent: "Rasterize PDF with 1 file and DPI 300: the single DPI field plus the rasterization hint above the CTA" },
  { name: "metadata-view", intent: "View Metadata result card: 10 label/value rows with an aligned label column" },
  { name: "dimensions-view", intent: "Page Dimensions result card: 5-row table, header and body columns line up" },
  { name: "extractimages-done", intent: "Extract Images done: Save All bar with 3 extracted image rows and centered check icons" },
  { name: "saveas-multi", intent: "Split done with 3 outputs (mocked): Save All bar + 3 happy status rows with check icons" },
  { name: "saveas-multi-error", intent: "Split done, one copy fails: error row with ✕, failure count and Retry action" },
  { name: "palette-open", intent: "Command palette overlay after Ctrl+K: centered panel, readable list" },
  { name: "palette-utility", intent: "Command palette filtered to 'metadata': utility tools visible with their 'Utility' category label (nav.utility) rendered in the category column" },
  { name: "settings", intent: "Settings screen: theme + language pills with the current choice highlighted" },
  { name: "office-form", intent: "Office to PDF with 1 .docx file queued (document placeholder card), the supported-formats hint visible below the drop zone, and the CTA enabled" },
  { name: "ebook-form", intent: "Ebook to PDF with 1 .epub file queued, font size 14 and margins filled: the two numeric fields and the format hint on one rhythm, CTA enabled" },
  { name: "comic-form", intent: "Comic to PDF with 1 .cbz file queued, the CBZ-only hint visible, CTA enabled" },
  { name: "ocr-form", intent: "OCR PDF with 1 file, language Japanese (日本語), DPI 300, the searchable-text checkbox ticked, and the Latin-only limitation hint visible in full; CTA enabled" },
  { name: "ocr-warning", intent: "OCR finished with a dropped-lines progress stage: the done card shows the red-tinted warning banner above the Save As bar" },
  { name: "tables-form", intent: "Extract Tables with Markdown selected, pages \"1-2\", and the table-detection hint visible; CTA enabled" },
  { name: "pdftomarkdown-form", intent: "PDF to Markdown with pages filled and the structure-is-approximate hint visible below the field; CTA enabled" },
  { name: "prepareai-form", intent: "Prepare for AI with pages \"2\" and the export hint under the field; CTA enabled" },
  { name: "attachments-add-form", intent: "Add Attachments with 1 PDF queued as a thumbnail card and 2 attachment rows (report.docx, data.xlsx) below the attachment files label, each with a remove ✕; CTA enabled" },
  { name: "attachments-extract-done", intent: "Extract Attachments finished with 3 output files: the Save All bar plus 3 status rows with centered check icons" },
  { name: "attachments-edit-view", intent: "Remove Attachments with the embedded-file list loaded (2 rows with sizes and checkboxes), the first row ticked, and the logical-removal hint visible; CTA enabled" },
  { name: "bookmarks-view", intent: "View Bookmarks result card showing a nested outline (3 top-level entries, two with children): each depth level indents further right, titles and page labels aligned" },
  { name: "bookmarks-edit-form", intent: "Edit Bookmarks with a PDF picked and the outline auto-loaded as flat rows (title + page inputs each), the Add row button and the replace hint visible; CTA enabled" },
  { name: "toc-form", intent: "Table of Contents with position \"After the first page\" selected, the localized default title in the field, and both hints (page-number shift and Latin-1) visible; CTA enabled" },
  { name: "editor-open", intent: "PDF Editor with a real 2-page PDF loaded: the page bitmap rendered inside the white page box, the tool rail on the left, and page navigation plus zoom controls in the top bar" },
  { name: "editor-annotated", intent: "Editor with the real page plus three marks: a rectangle outline, a translucent highlight band and a free text note, each sitting on the page where it was drawn" },
  { name: "editor-redact-marked", intent: "Editor showing a hatched MARKED redaction rectangle on the page and the red warning line under the canvas" },
  { name: "editor-selected", intent: "Editor with the rectangle mark selected: a dashed selection outline plus eight accent resize handles on the corners and edge midpoints" },
  { name: "editor-search-results", intent: "Editor search panel open with canned matches: the page-labelled result list on the right plus the accent pulse highlight on the page" },
  { name: "formfill-form", intent: "Fill Form with a canned form loaded: text, checkbox, dropdown and radio fields plus one read-only field, with the fields-found count" },
  { name: "formfill-filled", intent: "Fill Form with values entered: a text field typed, the checkbox ticked, the dropdown and radio chosen, and the read-only field left dimmed" },
  { name: "formfill-empty", intent: "Fill Form with a canned form that has zero fields: the honest empty message and no primary action button" },
  { name: "formcreate-placed", intent: "Create Form with three field rows, each carrying name, label, type and X/Y/W/H coordinates, plus the add-field button" },
  { name: "sign-draw", intent: "Sign PDF in Draw mode with an ink stroke drawn on the signature pad and the Clear action below it" },
  { name: "sign-type", intent: "Sign PDF in Type mode with signature text typed into the field" },
  { name: "stamp-form", intent: "Stamp PDF with the stamp text, an accent colour and a rotation value set" },
  { name: "removeannotations-form", intent: "Remove Annotations with three type checkboxes ticked and the All types toggle unticked" },
  { name: "sanitize-form", intent: "Sanitize PDF showing its five cleanup checkboxes, all ticked, with the notes below them" },
  { name: "bates-form", intent: "Bates Numbering with a position chosen, the 1 / 5 format selected and a prefix filled in" },
  { name: "pagelabels-form", intent: "Page Labels with a Roman numeral style and a prefix filled in" },
  { name: "removeblank-form", intent: "Remove Blank Pages with the tolerance slider moved and the percentage readout updated" },
  { name: "restrictions-form", intent: "Remove Restrictions with the password field filled and shown as masked dots" },
  { name: "textedit-open", intent: "PDF Editor with a real 2-page PDF loaded and the Edit text tool active: an inline editor is open over the clicked text run, prefilled with that run's text, with Apply and Cancel; the tool rail shows Edit text highlighted" },
  { name: "pdftoa-form", intent: "PDF to PDF/A with 1 file and the PDF/A-1b level selected: the version select, the archiving hint and an enabled CTA" },
  { name: "fontoutline-form", intent: "Font to Outline with 1 file and no options: the queue card, the outlines hint and the CTA" },
  { name: "deskew-form", intent: "Deskew PDF with 1 file and no options: the queue card, the skew hint and the CTA" },
  { name: "scanner-form", intent: "Scanner Effect with 1 file and the Black and white preset selected: the preset radio row, the rebuild hint and the CTA" },
  { name: "colors-form", intent: "Adjust Colors with 1 file and brightness 20, contrast 10, saturation -10, gamma 1.2: four numeric fields, the range hint and the CTA" },
  { name: "invert-form", intent: "Invert Colors with 1 file and no options: the queue card, the inversion hint and the CTA" },
  { name: "posterize-form", intent: "Posterize PDF with 1 file and 6 levels: the levels field with its inline hint and the CTA" },
  { name: "bgcolor-form", intent: "Background Color with 1 file and #FFF7E6 entered: the hex field, the fill hint and the CTA" },
  { name: "textcolor-form", intent: "Change Text Color with 1 file and #1D4ED8 entered: the hex field, the approximation hint and the CTA" },
  { name: "overlay-form", intent: "Overlay PDF with the base PDF queued and the overlay PDF picked, Underlay beneath selected: the second picker row with its remove chip, the placement radios, opacity, scale to fit and the CTA" },
  { name: "overlay-invalid", intent: "Overlay PDF with only the base PDF queued and no overlay picked: the second picker is empty, the inline \"choose an overlay file\" error shows and the CTA is visibly disabled" },
  { name: "workflow-form", intent: "Workflow Builder with 1 file and the default single step: the step row with its tool select, JSON textarea and remove chip, the Add step button, the threading hints and the CTA" },
  { name: "workflow-steps", intent: "Workflow Builder with a second step added: two step rows each with a numbered header and remove chip, the Add step button, the JSON input fields and the CTA" },
  { name: "signcert-form", intent: "Digital Signature with the PDF queued, a .p12 certificate picked, the passphrase filled as masked dots and name, reason and location entered: the certificate row, the masked passphrase and the CTA" },
  { name: "validate-view", intent: "Validate Signature result card for a signed PDF: six label/value rows (valid, signer, issuer, serial, expires, certificates), the revocation caveat below them and a Back action" },
  { name: "timestamp-form", intent: "Timestamp PDF with 1 file and an empty URL field: the URL field with its placeholder, the inline invalid-URL error, the network hint and a visibly disabled CTA" },
];

const CHECKLIST = [
  "Text overlap or clipping: no glyphs overlapping other glyphs; file names clamp to two lines with an ellipsis, not cut mid-glyph.",
  "Elements touching or escaping card edges (padding looks collapsed on any side).",
  "Misaligned buttons/controls: pill heights, vertical alignment within a row, inconsistent gaps.",
  "Bounding boxes changing size between comparable states - compare merge-files vs merge-longnames: every card must keep the same width and height.",
  "Queue cards (merge-files/merge-longnames/merge-many/*-form): each card shows a preview above the name; the delete ✕ sits in the same top-right corner of every card and never drifts when a name wraps.",
  "Placeholder cards: when a preview cannot be generated the card shows a centered document icon, not a broken image.",
  "Drag-over highlight clearly visible: border and/or background must obviously differ from merge-empty.",
  "Dark mode legibility (contrast feel) in home-dark: body vs card vs muted text must all read.",
  "CJK text rendering/wrapping: no tofu boxes, no orphaned punctuation, acceptable line breaks.",
  "zh-TW state fully translated: no stray English UI strings (file names are data and stay as-is).",
  "Palette overlay centered-ish at the top with a readable list inside the panel (panel must not stretch to full viewport height).",
  "Settings buttons clearly highlight the current selection (theme and language).",
  "Organize grid cells: all page tiles the same size, equal gutters, labels and the rotate/duplicate/delete buttons aligned inside each cell.",
  "Organize grid after rotate/delete (organize-grid-rotated): remaining cells keep their size and never collapse or jump columns.",
  "Organize drag state: the dragged cell must be visibly distinct from the cell under the pointer - the source carries a dashed accent border and the target a solid one; no stray text or unclipped ghost.",
  "Tall edit/edit-metadata forms (pagenumbers-form, watermark-text-form, headerfooter-form, editmetadata-form): the page title and the Back action stay in frame (the capture may scroll the form, but never past its own header). Header & Footer's Latin-1 note spans both columns as one line, so the field rows on the left and right stay on one rhythm.",
  "Option forms (split/extract/rotate/nup): radio rows, selects and inputs left-aligned with consistent vertical rhythm; the inline validation error (split-invalid) reads as an error and sits between the form and the CTA.",
  "Invalid vs valid CTA: split-invalid's button must look disabled (neutral/faded), clearly different from split-form's filled accent button.",
  "Save All bar (saveas-multi): status icons vertically centered with each file name; three rows aligned. In saveas-multi-error the failed row's ✕ is in the danger tone and a Retry action is visible.",
  "Data card rows (metadata-view): every label sits in the same left column and every value is left-aligned with the value column; no label wraps into two lines at this width.",
  "Data table (dimensions-view): the header and body columns line up (no ragged edges), rows keep an even height, and numeric cells are not clipped.",
  "Conditional field (pdftoimages-form): with WebP selected the Quality field is visible; the format select, DPI input and Quality input share one left edge.",
  "Convert forms (pdftotext-form, svg-form, cbz-form, greyscale-form, fixpagesize-form): fields, radio rows and hint texts are left-aligned on one rhythm; hint text is muted but legible and not clipped.",
  "Extract Images done (extractimages-done): the Save All rows show 3 distinct image file names with centered check icons.",
  "Convert-in forms (imagestopdf-form, textpdf-form, markdown-form, csvtopdf-form): image cards (imagestopdf) show a picture preview; textpdf/markdown/csvtopdf all show the SAME centered document placeholder card (a .md card must look identical to .txt/.csv); the disabled orientation radios in imagestopdf-form read as greyed out; every hint is muted but legible; the Create PDF button is enabled.",
  "Edit forms (pagenumbers-form, watermark-text-form, watermark-image-form, crop-form, headerfooter-form, editmetadata-form): radio rows, selects, numeric inputs and checkboxes stay left-aligned on one rhythm; watermark-image-form must NOT show text, font size, rotation, color or tile controls; editmetadata-form pairs each input with its clear checkbox without overlap.",
  "Password fields (protect-form, unlock-form): the filled password inputs show masked dots or circles, never the plaintext password; empty fields show a placeholder or blank box. Protect's two password fields align with each other; Allow printing is ticked and Allow copying is not.",
  "Utility/secure bare forms (flatten-form, removemetadata-form, pdfstozip-form, rasterize-form, compare-view): the bare tools show a centred queue card above the drop zone with the hint and enabled CTA below; pdfsToZip shows 3 PDF thumbnail cards wrapping evenly; rasterize-form shows the DPI field and hint.",
  "Compare result (compare-view): the five label/value rows share one left label column, values are left-aligned, no label wraps to two lines at this width, the None placeholder reads as an empty value, and the similarity caveat (\u201cFlags large visual changes\u2026\u201d) renders as muted small text between the rows and the Back action.",
  "Any text that looks cut off mid-glyph or truncated without an ellipsis.",
  "Attachment rows (attachments-add-form, attachments-edit-view): these are simple name+remove rows, NOT thumbnail cards; the file name and size (and the remove ✕ or checkbox) must stay on one line each and align in a column. In attachments-edit-view the ticked checkbox is visibly checked and the unticked one is not.",
  "Bookmark tree (bookmarks-view): the outline must read as a tree, with each deeper level indented further right than its parent, and every row's title and page label horizontally aligned within its level.",
  "OCR warning (ocr-warning): the warning banner is visible on the done card, above the Save As bar, in a red-tinted box, and its text is fully readable (not clipped).",
  "OCR form (ocr-form): the language select shows 日本語, DPI is 300, the searchable-text checkbox is ticked, and the long Latin-only hint is rendered in full without clipping.",
  "Editor tool rail (editor-open, editor-annotated, editor-selected): every tool icon is legible as its own glyph (no two icons look like a blur or a duplicate), the active tool is visibly highlighted, and the rail never overlaps the page canvas.",
  "Editor page render (editor-open): the page bitmap fills the white page box with no letterboxing gap, and the bitmap is not a blank white rectangle (faint black marks are visible somewhere on the page).",
  "Annotation overlay alignment (editor-annotated, editor-selected): the rectangle outline, the highlight band and the free-text note sit on the page at the drawn positions, not offset outside the white page box or floating over the tool rail.",
  "Redact marking (editor-redact-marked): the redaction rectangle reads as a dark 45 degree hatch with a dashed white border and a MARKED label; it must be visually distinct from a plain rectangle, and the red warning line under the canvas is present.",
  "Resize handles (editor-selected): exactly eight small accent squares, one at each corner and each edge midpoint of the dashed selection outline, with the handle centers on the outline.",
  "Search results (editor-search-results): the panel lists each match with a page label, and the accent pulse rectangle is visible on the page (not off the page or behind the tool rail).",
  "Form widgets (formfill-form, formfill-filled): each field type renders its own control (text box, checkbox, dropdown select, radio row), the read-only field is visibly dimmed, and in formfill-filled the ticked/selected controls are clearly checked while the others are not.",
  "Form fill empty (formfill-empty): the empty message is visible and there is NO primary CTA button under it.",
  "Form create rows (formcreate-placed): the three field rows each show name, label, type and four coordinate boxes aligned on one row, and the rows do not overlap the drop zone or CTA.",
  "Signature pad (sign-draw, sign-type): the pad ink is a visible dark stroke inside the pad box (not clipped to the border or outside it); in sign-type the typed name is visible in the text field and the pad is gone.",
  "Checked states (removeannotations-form, sanitize-form, removeblank-form): ticked checkboxes render a clear check mark and unticked ones render empty; the Remove Annotations All types toggle is visibly unticked while the three type boxes are ticked.",
  "Form field alignment (bates-form, pagelabels-form, stamp-form, restrictions-form): labels, controls and hints share one left edge and vertical rhythm; the password field in restrictions-form shows masked dots, never the plaintext.",
  "Advanced bare forms (fontoutline-form, deskew-form, invert-form): the queue card sits above the drop zone with the tool hint and an enabled CTA below; nothing overlaps and the hint is legible, not clipped.",
  "Advanced option forms (pdftoa-form, scanner-form, colors-form, posterize-form, bgcolor-form, textcolor-form, timestamp-form): the select, radio row, numeric fields and hex/URL inputs stay left-aligned on one rhythm; every hint is muted but legible; the CTA is clearly enabled when the input is valid (pdftoa/scanner/colors/bgcolor/textcolor) and visibly disabled when it is not (timestamp-form with an empty URL).",
  "Overlay second picker (overlay-form, overlay-invalid): the overlay picker button and its picked-file row (name plus a danger-tone remove chip) render inside the form without overlapping the radios or the CTA; in overlay-invalid the empty picker shows the inline error and a faded CTA, clearly different from the valid state.",
  "Workflow step rows (workflow-form, workflow-steps): each step is a bordered card with a numbered header, a danger remove chip at the same top-right corner, a tool select and a monospace JSON textarea; two steps in workflow-steps stack with equal width and gap; the JSON text is not clipped and the Add step button and hints sit below the rows.",
  "Digital signature form (signcert-form): the certificate row shows the picked file name without escaping the form box; the passphrase input renders masked dots, never the plaintext; name/reason/location inputs share one left edge with the passphrase.",
  "Validation result card (validate-view): six label/value rows share one left label column, values wrap inside the card, and the revocation caveat sits muted below the rows above the Back action. The \"Signature valid\" row must not read as a bare label with no value.",
  "Inline text editor (textedit-open): the editor sits over the clicked text run, its input is prefilled with the run's text and is not clipped by the page edge or the canvas scroll; the Apply and Cancel buttons are fully visible and the tool rail shows Edit text highlighted.",
];

function stateLine(s, i) {
  const n = String(i + 1).padStart(2, " ");
  return `${n}. \`screenshots/${s.name}.png\` - ${s.intent}`;
}

export function renderBrief({ report } = {}) {
  const lines = [];
  lines.push("# PogoPDF visual audit brief");
  lines.push("");
  lines.push("You are a vision-capable reviewer. PogoPDF's UI must be checked visually");
  lines.push("after every UI change. Read each PNG below as an image and report what you see.");
  lines.push("");
  lines.push("## Hard requirements");
  lines.push("");
  lines.push("- You MUST open and Read **every** image file listed below (one by one).");
  lines.push("- You MUST report on **every** image, even when you find nothing wrong (`no issues found`).");
  lines.push("- Base findings on what is actually in the pixels, not on this document's expectations.");
  lines.push("- Be concrete: name the screenshot and the element/location you mean.");
  lines.push("");
  lines.push("## Screenshots to review");
  lines.push("");
  lines.push("Paths are relative to `ui/` (e.g. `ui/screenshots/home-light.png`).");
  lines.push("");
  for (let i = 0; i < STATES.length; i++) lines.push(stateLine(STATES[i], i));
  lines.push("");
  lines.push("## Audit checklist (apply to every image)");
  lines.push("");
  for (const c of CHECKLIST) lines.push(`- ${c}`);
  lines.push("");
  lines.push("## Output format");
  lines.push("");
  lines.push("Return **only** a JSON array (no prose around it). One object per finding.");
  lines.push("Severity is one of `critical`, `important`, `minor`. If an image is clean,");
  lines.push("emit one object with `severity: \"minor\"` and `issue: \"no issues found\"` so");
  lines.push("coverage is provable. Example:");
  lines.push("");
  lines.push("```json");
  lines.push("[");
  lines.push('  {');
  lines.push('    "screenshot": "merge-longnames.png",');
  lines.push('    "severity": "important",');
  lines.push('    "issue": "Delete ✕ sits above the vertical center of a two-line file name",');
  lines.push('    "location": "merge file list, 2nd row, trailing ✕ button",');
  lines.push('    "suggestion": "Center the ✕ against the row box rather than the name span"');
  lines.push("  },");
  lines.push('  {');
  lines.push('    "screenshot": "home-light.png",');
  lines.push('    "severity": "minor",');
  lines.push('    "issue": "no issues found",');
  lines.push('    "location": "whole screen",');
  lines.push('    "suggestion": "none"');
  lines.push("  }");
  lines.push("]");
  lines.push("```");
  lines.push("");
  lines.push("## Metrics report (deterministic checks, for context only)");
  lines.push("");
  lines.push("The harness also emits `screenshots/report.json`. If it is present, use it");
  lines.push("as supporting evidence, but do not let it replace your own reading of the PNGs.");
  if (report) {
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify({ states: report.states?.map((s) => ({ name: s.name, invariants: s.invariants })) }, null, 2));
    lines.push("```");
  }
  lines.push("");
  return lines.join("\n");
}

export function writeAuditBrief({ report } = {}) {
  mkdirSync(dirname(briefPath), { recursive: true });
  writeFileSync(briefPath, renderBrief({ report }), "utf8");
  return briefPath;
}

// Allow `node scripts/write-audit-prompt.mjs` to (re)generate the brief, folding
// in an existing report.json when one is on disk.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let report;
  const reportPath = join(shotsDir, "report.json");
  if (existsSync(reportPath)) {
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
    } catch {
      report = undefined;
    }
  }
  const out = writeAuditBrief({ report });
  console.log(`Audit brief written to ${out}`);
}
