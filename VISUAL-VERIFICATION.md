# Visual verification

This document defines PogoPDF's permanent UI/UX verification workflow. It is the
counterpart to the unit tests: those prove behaviour, this proves the interface
still looks and reads correctly.

> **The rule.** Every UI change — anything that alters what the user sees or can
> act on — must run `npm run shots` and pass **both** gates before it is done:
> a green metrics report (`ui/screenshots/report.json`) **and** a vision review
> of every PNG. "It compiles and the tests pass" is not sufficient for a UI
> change.

## How to run

From the repo root:

```
npm run shots
```

The script starts Vite itself (and tears it down) or reuses a running
`npm run dev -w ui`, opens `http://localhost:5173/?mock=1` at 1280x800 in the
system Edge or Chrome via `puppeteer-core`, drives the UI through the dev-only
Tauri mock (`ui/src/dev/mock-tauri.ts`), and writes to `ui/screenshots/`
(gitignored):

- `<state>.png` — one screenshot per state.
- `<state>.metrics.json` — the raw layout metrics for that state.
- `report.json` — per-state invariants + the evidence numbers, plus cross-state
  checks. Exits non-zero if any invariant fails.
- `.superpowers/sdd/visual-audit-brief.md` (gitignored) — the prompt for the
  vision reviewer, regenerated automatically (or run
  `node ui/scripts/write-audit-prompt.mjs` to rebuild it from an existing report).

Requirements: Node 20+, an installed Edge/Chrome (no Chromium is downloaded).
`npm run shots` drives a real browser and is not run in CI here, but its exit
code is a CI-able gate.

## The state matrix

| State | What it captures |
|---|---|
| `home-light` | Home tool grid, light theme |
| `home-dark` | Home, dark theme (dark tokens applied) |
| `merge-empty` | Merge opened, no files, drop zone idle, CTA disabled |
| `merge-dragover` | Files hovering the drop zone, before release |
| `merge-files` | Merge with 3 short-named PDFs |
| `merge-longnames` | Merge with long (incl. CJK) names that wrap to 2+ lines |
| `merge-many` | Merge with 8 files |
| `merge-running` | Merge in progress at 62% |
| `merge-done` | Merge finished, Save As bar |
| `merge-error` | Merge failed, danger-tone error card |
| `merge-zhtw` | Merge in zh-TW, all strings translated |
| `palette-open` | Command palette after Ctrl+K |
| `settings` | Settings, theme + language pills |

## Reading `report.json`

`report.json` has `allPass`, a `failures` list, and per-state `invariants` with
the supporting `evidence`. Invariants:

- `no-overlap` — no two leaf siblings in the same flex/grid container intersect.
- `no-unintended-clipping` — no visible element overflows its box
  (`scrollWidth/Height > client + 1`), except by-design scroll containers and the
  window scroll on `html`/`body`/`#root`.
- `rows-centered` — in merge file rows, the delete ✕ vertical center matches the
  name container's center (≤1px), even when the name wraps.
- `rows-consistent-height` — single-line rows in a state are the same height
  (≤1px spread); wrapped rows are reported separately.
- `dragover-state-visible` — the drop zone's computed border and background
  colors differ between `merge-empty` and `merge-dragover`.
- `theme-tokens-correct` — `home-light` body background is `#F5F5F0`
  (`rgb(245, 245, 240)`) and `home-dark` is `#1C1C1A` (`rgb(28, 28, 26)`), read
  from computed styles and compared against `ui/src/theme.css`.

A failure prints a `state: invariant` list and exits 1. **Fix the UI, not the
check**, unless the check itself is provably wrong (e.g. an intentional modal
overlay tripping the leaf-overlap rule).

## The vision-review loop

Metrics catch geometry; a vision pass catches everything else. The controller
model cannot read images, so it dispatches a vision-capable subagent:

1. Run `npm run shots` — it writes the brief to
   `.superpowers/sdd/visual-audit-brief.md`.
2. Dispatch a vision subagent with that brief. It must **Read every PNG** and
   report per image (including "no issues found"), returning a JSON array of
   `{ screenshot, severity, issue, location, suggestion }`.
3. File the findings. Fix real issues in `ui/src/`.
4. Re-run `npm run shots`, then the vision pass again. Repeat until both gates
   are clean.

## Adding a state

When a new tool or screen lands, extend the matrix in three places:

1. `ui/scripts/write-audit-prompt.mjs` — add `{ name, intent }` to `STATES`
   (the canonical list; `screenshots.mjs` warns if a captured PNG is missing
   here).
2. `ui/scripts/screenshots.mjs` — capture it: set prefs/route, drive the mock,
   then `await shot("<name>")`.
3. Metrics invariants — if the state has new structure worth checking (a list, a
   panel, a toggle), add a `data-testid` in the component and a corresponding
   check in `ui/scripts/metrics.mjs` (`evaluateState`), and describe what the
   reviewer should look for in the brief checklist.

Each user-action state should have: a name, a mock setup, and metrics invariants.

## Troubleshooting

- **No browser found** — install Edge or Chrome, or add its path to `BROWSERS`
  in `ui/scripts/screenshots.mjs`.
- **Port 5173 busy** — the harness reuses whatever answers on `localhost:5173`.
  If a stale server is wrong, stop it; `vite.config.ts` uses `strictPort: true`
  so a second server will not silently pick another port.
- **A stale `.metrics.json` after removing a state** — the harness wipes
  `ui/screenshots/` at the start of every run.

## Release packaging

Packaging (engine build order, embedding, installer) is documented where it
happens: `engine/scripts/build-release.ps1` and
`src-tauri/binaries/README.md`. Build the engine before `npx tauri build` — a
stale or missing staged engine still "builds" but ships an app with no engine.
