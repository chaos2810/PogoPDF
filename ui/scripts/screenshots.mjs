// Visual verification harness for the UI. Captures the app in a real browser
// against the dev-only Tauri mock (ui/src/dev/mock-tauri.ts, loaded via ?mock=1).
//
// Usage: npm run shots   (from the repo root, or `npm run shots -w @pogopdf/ui`)
//
// For every state the harness writes three artifacts to ui/screenshots/ (all
// gitignored): <name>.png, <name>.metrics.json (raw layout numbers), and one
// aggregate report.json (per-state invariants + evidence). It also writes the
// vision-review brief to .superpowers/sdd/visual-audit-brief.md.
//
// Exit code is non-zero if any layout invariant fails (CI gate), listing the
// failures. The PNGs still get written so a human/vision agent can inspect.
//
// Starts Vite itself when nothing is listening on the dev port and tears it
// down afterwards; reuses an already-running dev server otherwise.
// Requires a local Chromium browser: Edge (preferred) or Chrome. No browser is
// downloaded — puppeteer-core drives the system binary.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

import {
  collectPageMetrics,
  evaluateState,
  evaluateDragover,
  evaluateGridRotate,
  evaluateGridDragging,
  evaluateSaveAllError,
} from "./metrics.mjs";
import { writeAuditBrief, STATES } from "./write-audit-prompt.mjs";

const KNOWN_STATES = new Set(STATES.map((s) => s.name));

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(__dirname, "..");
const repoRoot = resolve(uiDir, "..");
const shotsDir = join(uiDir, "screenshots");
const PORT = 5173;
const BASE = `http://localhost:${PORT}/`;
const URL = `${BASE}?mock=1`;

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const BROWSERS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  process.env.LOCALAPPDATA + "\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
];

function findBrowser() {
  for (const p of BROWSERS) {
    if (p && existsSync(p)) return p;
  }
  throw new Error(
    "No Edge or Chrome found. Install one, or edit BROWSERS in ui/scripts/screenshots.mjs."
  );
}

async function isUp() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isUp()) return;
    await sleep(300);
  }
  throw new Error(`Vite did not come up on ${BASE} within ${timeoutMs}ms`);
}

async function startVite() {
  const viteBin = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(viteBin)) throw new Error(`Vite bin not found at ${viteBin}`);
  const child = spawn(process.execPath, [viteBin], {
    cwd: uiDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  child.stdout.on("data", (d) => process.stdout.write(`[vite] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
  return child;
}

// --- page helpers ---

async function clickButton(page, text) {
  const ok = await page.evaluate((needle) => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent && b.textContent.includes(needle)
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, text);
  if (!ok) throw new Error(`No button containing "${text}"`);
}

// Native radios and inputs keep mouse focus after a scripted click, so the
// :focus-visible ring leaks into later captures. Blur whatever holds focus
// after driving a state so screenshots reflect the resting UI.
async function blurActive(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && el !== document.body) el.blur();
  });
}

async function clickAria(page, label) {
  const ok = await page.evaluate((l) => {
    const btn = document.querySelector(`button[aria-label="${l}"]`);
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
  if (!ok) throw new Error(`No button with aria-label "${label}"`);
}

// Home tool card lookup by its rendered English title. Scrolls the card into
// view before clicking so long grids (15 tools) are reachable.
async function openTool(page, title) {
  const ok = await page.evaluate((needle) => {
    const btn = [...document.querySelectorAll("button")].find((b) => {
      const strong = b.querySelector("strong");
      return strong?.textContent?.trim() === needle;
    });
    if (!btn) return false;
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return true;
  }, title);
  if (!ok) throw new Error(`Tool card "${title}" not found on home`);
  await sleep(200);
}

async function clickTestId(page, id) {
  const ok = await page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, id);
  if (!ok) throw new Error(`No element with data-testid "${id}"`);
}

// React installs a value setter on the input prototype; assigning through it
// then dispatching `input` is what makes a controlled component update.
async function typeInto(page, id, text) {
  const ok = await page.evaluate(
    ([tid, value]) => {
      const el = document.querySelector(`[data-testid="${tid}"]`);
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    [id, text]
  );
  if (!ok) throw new Error(`No input with data-testid "${id}"`);
  await sleep(80);
}

// The option controls are label-wrapped: click the label whose text matches.
// Uses a trusted mouse click (not label.click()) so focus modality matches a
// real pointer: a synthetic click leaves :focus-visible matching, painting a
// ring the user would never see.
async function clickLabel(page, name, text) {
  const box = await page.evaluate(
    ([n, needle]) => {
      const label = [...document.querySelectorAll(`input[name="${n}"]`)].find((i) => {
        const l = i.closest("label");
        return l?.textContent?.trim() === needle;
      })?.closest("label");
      if (!label) return null;
      label.scrollIntoView({ block: "center" });
      const r = label.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    [name, text]
  );
  if (!box) throw new Error(`No radio labelled "${text}" in group "${name}"`);
  await page.mouse.click(box.x, box.y);
  await sleep(80);
}

async function selectByValue(page, id, value) {
  const ok = await page.evaluate(
    ([tid, val]) => {
      const sel = document.querySelector(`[data-testid="${tid}"]`);
      if (!sel) return false;
      sel.value = val;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    [id, value]
  );
  if (!ok) throw new Error(`No select with data-testid "${id}"`);
  await sleep(80);
}

async function setPrefs(page, prefs) {
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.evaluate((p) => {
    for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v);
  }, prefs);
  await page.reload({ waitUntil: "networkidle0" });
}

async function openMerge(page) {
  const ok = await page.evaluate(() => {
    const grid = [...document.querySelectorAll("strong")].find(
      (s) => s.textContent === "Merge PDF" || s.textContent === "合併 PDF"
    );
    const btn = grid?.closest("button");
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!ok) throw new Error("Merge tool card not found on home");
  await sleep(150);
}

const SHORT = [
  "C:\\Users\\demo\\Documents\\invoice-2024.pdf",
  "C:\\Users\\demo\\Documents\\contract.pdf",
  "C:\\Users\\demo\\Downloads\\scan.pdf",
];

const LONG = [
  "C:\\Users\\demo\\Documents\\2024-Q3-Revenue-Reconciliation-Appendix-and-Audit-Notes-with-Corrections.pdf",
  "C:\\Users\\demo\\Documents\\研究計画書-最終版-提出用-関係者レビュー反映済み-第3稿-承認待ち-修正版.pdf",
  "C:\\Users\\demo\\Documents\\a-very-long-file-name-that-keeps-going-and-going-without-any-spaces-at-all-whatsoever.pdf",
];

const MANY = Array.from({ length: 8 }, (_, i) => `C:\\Users\\demo\\batch\\document-${i + 1}.pdf`);

// Tiny 2-page PDF (page 2 has /Rotate 90) generated with pdf-lib; used by the
// organize-grid-real state to exercise the real pdf.js pipeline end to end.
const REAL_PDF_B64 =
  "JVBERi0xLjcKJYGBgYEKCjYgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL09ialN0bQovTiA1Ci9GaXJzdCAyNgovTGVuZ3RoIDI3OAo+PgpzdHJlYW0KeJzVkj1rwzAQhnf9ihubSWfJlu1gDI0/llIIplNLBhGLYChRkW1o/33vorSlQ+nSpcNrSb7npJPeSwBBQYagoUghhUwXkIFJNFSVkA9vLw7k3p7cLOTdNM7wRAzCQAx/D0I2fj0voERdi6+Mxi722Z9ETIWE4Q9iH/y4Hl2Aqu/6HjFHRJOSDKJqaWxIJUnRmmKqoDkpT6+if7lG1LcU66NMHnM4fmGza35HI7GGmTayaRHXn+fyWV3cQ/1WT1kLee/H1i4ObtqtQmWwTAyaJMPicUPPEZxd/P+93KX+yZ9/vOE3n9leNjk46oHoshzc7NdwJNuJq/m93DjZnX+l3kHuNqRmIx3+cis5+IUrLpG5dx/wpusKZW5kc3RyZWFtCmVuZG9iagoKNyAwIG9iago8PAovU2l6ZSA4Ci9Sb290IDIgMCBSCi9JbmZvIDMgMCBSCi9GaWx0ZXIgL0ZsYXRlRGVjb2RlCi9UeXBlIC9YUmVmCi9MZW5ndGggMzYKL1cgWyAxIDIgMiBdCi9JbmRleCBbIDAgOCBdCj4+CnN0cmVhbQp4nBXEsQ0AIAwDMKcgZg7n56J6MLrLYcpU05p2XJLHB09iAtAKZW5kc3RyZWFtCmVuZG9iagoKc3RhcnR4cmVmCjM5NgolJUVPRg==";

const IMAGE_OUT = [
  "C:\\Users\\demo\\AppData\\Local\\Temp\\pogopdf\\job\\report\\image-1.jpg",
  "C:\\Users\\demo\\AppData\\Local\\Temp\\pogopdf\\job\\report\\image-2.jpg",
  "C:\\Users\\demo\\AppData\\Local\\Temp\\pogopdf\\job\\report\\image-3.jpg",
];

const SPLIT_OUT = [
  "C:\\Users\\demo\\AppData\\Local\\Temp\\pogopdf\\job\\invoice-2024\\part-1.pdf",
  "C:\\Users\\demo\\AppData\\Local\\Temp\\pogopdf\\job\\invoice-2024\\part-2.pdf",
  "C:\\Users\\demo\\AppData\\Local\\Temp\\pogopdf\\job\\invoice-2024\\part-3.pdf",
];

async function main() {
  rmSync(shotsDir, { recursive: true, force: true });
  mkdirSync(shotsDir, { recursive: true });

  const browserPath = findBrowser();
  console.log(`Browser: ${browserPath}`);

  let vite = null;
  if (await isUp()) {
    console.log("Reusing dev server on", BASE);
  } else {
    console.log("Starting Vite…");
    vite = await startVite();
    await waitForServer();
  }

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--force-device-scale-factor=1"],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  const mock = (fn, ...args) => page.evaluate(fn, ...args);

  // Capture a state: PNG + metrics JSON. `collectPageMetrics` is serialized into
  // the page, so it must stay self-contained (see scripts/metrics.mjs).
  const captures = new Map();
  const shot = async (name) => {
    await blurActive(page);
    await page.screenshot({ path: join(shotsDir, `${name}.png`) });
    const raw = await page.evaluate(collectPageMetrics);
    writeFileSync(
      join(shotsDir, `${name}.metrics.json`),
      JSON.stringify(raw, null, 2),
      "utf8"
    );
    if (!KNOWN_STATES.has(name)) {
      console.warn(`  ! ${name} has no entry in the audit matrix (scripts/write-audit-prompt.mjs)`);
    }
    const { invariants, evidence } = evaluateState(name, raw);
    captures.set(name, { raw, invariants, evidence });
    console.log(`  ✓ ${name}.png (+ .metrics.json)`);
  };

  try {
    // --- home ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await shot("home-light");

    await page.evaluate(() => localStorage.setItem("pogopdf.theme", "dark"));
    await page.reload({ waitUntil: "networkidle0" });
    await shot("home-dark");

    // --- merge: empty ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openMerge(page);
    await shot("merge-empty");

    // --- merge: drag-over ---
    await mock((p) => window.__mockDragEnter(p), SHORT);
    await sleep(120);
    await shot("merge-dragover");

    // --- merge: files (3 short names) ---
    await mock(() => window.__mockDragLeave());
    await mock((p) => window.__mockDrop(p), SHORT);
    await sleep(120);
    await shot("merge-files");

    // --- merge: long names incl. CJK ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openMerge(page);
    await mock((p) => window.__mockDrop(p), LONG);
    await sleep(120);
    await shot("merge-longnames");

    // --- merge: many files ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openMerge(page);
    await mock((p) => window.__mockDrop(p), MANY);
    await sleep(120);
    await shot("merge-many");

    // --- merge: running (62%) ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openMerge(page);
    await mock((p) => window.__mockDrop(p), SHORT);
    await mock(() => window.__mockJobControl("hold"));
    await clickButton(page, "Merge PDFs");
    await sleep(100);
    await mock(() => window.__mockProgress({ percent: 62, stage: "merging", pagesDone: 1 }));
    await sleep(250);
    await shot("merge-running");

    // --- merge: cancelled → back to pick with the file list intact ---
    // Cancel settles the held job.start with the engine's CANCELLED error; the
    // screen must treat it as a user action (pick phase), not an error card.
    await clickTestId(page, "merge-cancel");
    await sleep(250);
    await shot("merge-cancelled");

    // --- merge: done ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openMerge(page);
    await mock((p) => window.__mockDrop(p), SHORT);
    await mock(() => window.__mockJobControl("auto"));
    await clickButton(page, "Merge PDFs");
    await sleep(400);
    await shot("merge-done");

    // --- merge: error ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openMerge(page);
    await mock((p) => window.__mockDrop(p), SHORT);
    await mock(() => window.__mockJobControl("error"));
    await clickButton(page, "Merge PDFs");
    await sleep(300);
    await shot("merge-error");

    // --- merge: zh-TW with files ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "zh-TW" });
    await openMerge(page);
    await mock((p) => window.__mockDrop(p), SHORT);
    await sleep(120);
    await shot("merge-zhtw");

    // --- split: valid ranges form ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Split PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await mock(() => window.__mockSetOutputPaths(null));
    await typeInto(page, "split-ranges", "1-3,5");
    await shot("split-form");

    // --- split: invalid ranges (validation error, CTA disabled) ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Split PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "split-ranges", "abc");
    await shot("split-invalid");

    // --- extract pages form ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Extract Pages");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "extract-pages", "2-4");
    await shot("extract-form");

    // --- organize grid (6 mocked page thumbnails) ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Organize Pages");
    await mock(() => window.__mockPdfThumbs(6));
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await sleep(300);
    await shot("organize-grid");

    // --- organize grid: one cell rotated ---
    await clickTestId(page, "grid-rotate");
    await sleep(200);
    await shot("organize-grid-rotated");

    // --- organize grid: mid pointer-drag (pointerdown + move over cell 3) ---
    const cells = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="grid-cell"]')].slice(0, 3).map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })
    );
    await page.mouse.move(cells[0].x, cells[0].y);
    await page.mouse.down();
    await page.mouse.move(cells[1].x, cells[1].y, { steps: 6 });
    await page.mouse.move(cells[2].x, cells[2].y, { steps: 6 });
    await sleep(150);
    await shot("organize-dragging");
    await page.mouse.up();
    await sleep(100);

    // --- organize grid: real pdf.js over a blob-backed 2-page PDF ---
    // Exercises the actual renderPdfThumbs pipeline (no mock thumbs): the
    // fixture's page 2 has /Rotate 90, so its cell must show a 90° transform.
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Organize Pages");
    await page.evaluate((b64) => {
      const bin = atob(b64);
      const bytes = new Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      window.__mockSetFiles([window.__mockBlobPath(bytes)]);
    }, REAL_PDF_B64);
    await clickTestId(page, "organize-dropzone");
    await sleep(1200);
    await shot("organize-grid-real");

    // --- rotate form ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Rotate PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickLabel(page, "rotate-angle", "90°");
    await typeInto(page, "rotate-pages", "2-3");
    await shot("rotate-form");

    // --- booklet (no options) ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Booklet");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await shot("booklet-form");

    // --- nup form ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "N-up");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await selectByValue(page, "nup-layout", "2x2");
    await shot("nup-form");

    // --- PDF to Images: webp format shows the conditional Quality field ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "PDF to Images");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await selectByValue(page, "pdftoimages-format", "webp");
    await typeInto(page, "pdftoimages-dpi", "300");
    await typeInto(page, "pdftoimages-quality", "90");
    await shot("pdftoimages-form");

    // --- PDF to Text: pages filled ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "PDF to Text");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "pdftotext-pages", "2-3");
    await shot("pdftotext-form");

    // --- PDF to SVG: dpi + raster hint visible ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "PDF to SVG");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "pdftosvg-dpi", "300");
    await shot("svg-form");

    // --- PDF to CBZ: dpi field ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "PDF to CBZ");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "pdftocbz-dpi", "300");
    await shot("cbz-form");

    // --- PDF to Greyscale: pages input ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "PDF to Greyscale");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "pdftogreyscale-pages", "1-3");
    await shot("greyscale-form");

    // --- Fix Page Size: a4/portrait/scale + hint ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Fix Page Size");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await selectByValue(page, "fixpagesize-size", "a4");
    await clickLabel(page, "fixpagesize-orientation", "Portrait");
    await clickLabel(page, "fixpagesize-fit", "Scale to fit");
    await shot("fixpagesize-form");

    // --- View Metadata: canned data card ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "View Metadata");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickTestId(page, "viewMetadata-cta");
    await sleep(300);
    await shot("metadata-view");

    // --- Page Dimensions: canned 5-page table ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Page Dimensions");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickTestId(page, "pageDimensions-cta");
    await sleep(300);
    await shot("dimensions-view");

    // --- Extract Images done: 3 image outputs → multi Save All ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Extract Images");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await mock((p) => window.__mockSetOutputPaths(p), IMAGE_OUT);
    await mock(() => window.__mockJobControl("auto"));
    await clickTestId(page, "extractImages-cta");
    await sleep(400);
    await clickTestId(page, "save-all");
    await sleep(400);
    await shot("extractimages-done");
    await mock(() => window.__mockSetOutputPaths(null));

    // --- split done: 3 outputs, Save All → 3 happy rows ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Split PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await mock((p) => window.__mockSetOutputPaths(p), SPLIT_OUT);
    await mock(() => window.__mockCopyFail("part-2.pdf", false));
    await mock(() => window.__mockJobControl("auto"));
    await typeInto(page, "split-ranges", "1-3,5");
    await clickTestId(page, "split-cta");
    await sleep(400);
    await clickTestId(page, "save-all");
    await sleep(400);
    await shot("saveas-multi");

    // --- split done: one copy fails → error row + Retry ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Split PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await mock((p) => window.__mockSetOutputPaths(p), SPLIT_OUT);
    await mock(() => window.__mockCopyFail("part-2.pdf", true));
    await mock(() => window.__mockJobControl("auto"));
    await typeInto(page, "split-ranges", "1-3,5");
    await clickTestId(page, "split-cta");
    await sleep(400);
    await clickTestId(page, "save-all");
    await sleep(400);
    await shot("saveas-multi-error");
    await mock(() => window.__mockCopyFail("part-2.pdf", false));

    // --- palette ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await page.keyboard.down("Control");
    await page.keyboard.press("k");
    await page.keyboard.up("Control");
    await sleep(150);
    await shot("palette-open");

    // --- settings ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await clickAria(page, "Settings");
    await sleep(150);
    await shot("settings");
  } finally {
    await browser.close();
    if (vite) {
      vite.kill();
      await sleep(300);
    }
  }

  // --- cross-state invariants + report.json ---
  const dragover = evaluateDragover(captures.get("merge-empty")?.raw, captures.get("merge-dragover")?.raw);
  const dragoverCapture = captures.get("merge-dragover");
  if (dragoverCapture) {
    dragoverCapture.invariants["dragover-state-visible"] = dragover.pass;
    dragoverCapture.evidence.dragoverEvidence = dragover;
  }

  const gridRotate = evaluateGridRotate(
    captures.get("organize-grid")?.raw,
    captures.get("organize-grid-rotated")?.raw
  );
  const gridRotateCapture = captures.get("organize-grid-rotated");
  if (gridRotateCapture) {
    gridRotateCapture.invariants["grid-rotate-visible"] = gridRotate.pass;
    gridRotateCapture.evidence.gridRotate = gridRotate;
  }

  const gridDrag = evaluateGridDragging(
    captures.get("organize-grid")?.raw,
    captures.get("organize-dragging")?.raw
  );
  const gridDragCapture = captures.get("organize-dragging");
  if (gridDragCapture) {
    gridDragCapture.invariants["grid-dragging-visible"] = gridDrag.pass;
    gridDragCapture.evidence.gridDragging = gridDrag;
  }

  const saveAllError = evaluateSaveAllError(
    captures.get("saveas-multi")?.raw,
    captures.get("saveas-multi-error")?.raw
  );
  const saveAllErrorCapture = captures.get("saveas-multi-error");
  if (saveAllErrorCapture) {
    saveAllErrorCapture.invariants["saveall-error-row"] = saveAllError.pass;
    saveAllErrorCapture.evidence.saveAllError = saveAllError;
  }

  const states = [...captures.entries()].map(([name, c]) => ({
    name,
    invariants: c.invariants,
    evidence: c.evidence,
  }));

  const failures = [];
  for (const s of states) {
    for (const [key, val] of Object.entries(s.invariants)) {
      if (val === false) failures.push(`${s.name}: ${key}`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    screenshotCount: states.length,
    allPass: failures.length === 0,
    failures,
    dragover: dragover,
    gridRotate: gridRotate,
    gridDragging: gridDrag,
    saveAllError: saveAllError,
    states,
  };

  writeFileSync(join(shotsDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  const brief = writeAuditBrief({ report });

  console.log(`\nScreenshots written to ${shotsDir}`);
  console.log(`Metrics report: ${join(shotsDir, "report.json")}`);
  console.log(`Vision brief:   ${brief}`);

  if (failures.length > 0) {
    console.error(`\nINVARIANT FAILURES (${failures.length}):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`\nAll invariants PASS (${states.length} states).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
