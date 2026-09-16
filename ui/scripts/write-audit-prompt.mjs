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
  { name: "merge-files", intent: "Merge tool with 3 short-named PDFs listed, CTA enabled" },
  { name: "merge-longnames", intent: "Merge tool with 3 long (incl. CJK) file names that wrap to 2+ lines" },
  { name: "merge-many", intent: "Merge tool with 8 files: list length, separators, scroll behaviour" },
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
  { name: "saveas-multi", intent: "Split done with 3 outputs (mocked): Save All bar + 3 happy status rows with check icons" },
  { name: "saveas-multi-error", intent: "Split done, one copy fails: error row with ✕, failure count and Retry action" },
  { name: "palette-open", intent: "Command palette overlay after Ctrl+K: centered panel, readable list" },
  { name: "settings", intent: "Settings screen: theme + language pills with the current choice highlighted" },
];

const CHECKLIST = [
  "Text overlap or clipping: no glyphs overlapping other glyphs; watch the file-name span vs. the delete ✕ in merge rows.",
  "Elements touching or escaping card edges (padding looks collapsed on any side).",
  "Misaligned buttons/controls: pill heights, vertical alignment within a row, inconsistent gaps.",
  "Bounding boxes changing size between comparable states — compare merge-files vs merge-longnames: the card width must not change.",
  "Delete ✕ vertical centering when a file name wraps to two lines (✕ should sit on the row's vertical center, not the first line's).",
  "Drag-over highlight clearly visible: border and/or background must obviously differ from merge-empty.",
  "Dark mode legibility (contrast feel) in home-dark: body vs card vs muted text must all read.",
  "CJK text rendering/wrapping: no tofu boxes, no orphaned punctuation, acceptable line breaks.",
  "zh-TW state fully translated: no stray English UI strings (file names are data and stay as-is).",
  "Palette overlay centered-ish at the top with a readable list inside the panel (panel must not stretch to full viewport height).",
  "Settings buttons clearly highlight the current selection (theme and language).",
  "Organize grid cells: all page tiles the same size, equal gutters, labels and the rotate/duplicate/delete buttons aligned inside each cell.",
  "Organize grid after rotate/delete (organize-grid-rotated): remaining cells keep their size and never collapse or jump columns.",
  "Organize drag state: the dragged cell must be visibly distinct (e.g. accent border/opacity) from the cell under the pointer; no stray text or unclipped ghost.",
  "Option forms (split/extract/rotate/nup): radio rows, selects and inputs left-aligned with consistent vertical rhythm; the inline validation error (split-invalid) reads as an error and sits between the form and the CTA.",
  "Invalid vs valid CTA: split-invalid's button must look disabled (neutral/faded), clearly different from split-form's filled accent button.",
  "Save All bar (saveas-multi): status icons vertically centered with each file name; three rows aligned. In saveas-multi-error the failed row's ✕ is in the danger tone and a Retry action is visible.",
  "Any text that looks cut off mid-glyph or truncated without an ellipsis.",
];

function stateLine(s, i) {
  const n = String(i + 1).padStart(2, " ");
  return `${n}. \`screenshots/${s.name}.png\` — ${s.intent}`;
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
