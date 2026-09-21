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

// Tall option forms push the primary CTA below the 800px fold, so a capture would
// cut off mid-form. The action helpers (clickLabel/clickCheckbox) scroll a control
// to the center as a side effect, so a capture can begin part way down the page
// even when the form fits. Always measure from the top:
//
//   scroll = min(max(0, cta.bottom - innerHeight), max(0, back.top - 4))
//
// A form that fits stays at scroll 0, so its title and Back action stay visible.
// When the form outgrows the viewport the CTA wins (every option form must show
// its CTA), but the scroll is still clamped to the Back action so the page chrome
// never leaves the frame; only a form taller than the gap between chrome and fold
// can leave the CTA's last few pixels below the edge.
async function scrollCtaIntoView(page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const cta = document.querySelector('[data-testid$="-cta"]');
    if (!cta) return;
    // Target the CTA's bottom edge at the fold exactly; a form is "framed" once
    // the whole button is on screen.
    const overflowBelow = cta.getBoundingClientRect().bottom - window.innerHeight;
    if (overflowBelow <= 0) return;
    // The Back action sits at the very top of the page, so it is the tightest
    // clamp: scrolling past it would leave no page chrome in frame. 4px of
    // clearance absorbs sub-pixel scroll rounding.
    const back = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("←")
    );
    const chromeClamp = back
      ? Math.max(0, back.getBoundingClientRect().top - 4)
      : overflowBelow;
    window.scrollBy({ top: Math.min(overflowBelow, chromeClamp) });
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

// Checkboxes are label-wrapped like the radios; click the box itself with a
// trusted mouse click so its checked state flips and no :focus-visible ring
// leaks into the capture.
async function clickCheckbox(page, id) {
  const box = await page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  if (!box) throw new Error(`No checkbox with data-testid "${id}"`);
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

// Images to PDF queues pictures, not PDFs (the picker/drop filters on image
// extensions), so its cards must show an image preview rather than the file
// placeholder icon.
const IMAGES = [
  "C:\\Users\\demo\\Pictures\\scan-front.png",
  "C:\\Users\\demo\\Pictures\\diagram.jpg",
  "C:\\Users\\demo\\Pictures\\photo.webp",
];

// Text-shaped inputs for the convert-in tools: each has its own extension, so
// drag-drop acceptance and the queue card differ from the PDF tools.
const TEXT_FILE = "C:\\Users\\demo\\Documents\\meeting-notes.txt";
const MARKDOWN_FILE = "C:\\Users\\demo\\Documents\\release-notes.md";
const CSV_FILE = "C:\\Users\\demo\\Documents\\inventory-q3.csv";

// 2-page PDF (page 2 has /Rotate 90) generated with pdf-lib, with visible text
// on both pages. Shared by organize-grid-real (real pdf.js pipeline, one rotated
// cell) and the editor states (the page bitmaps must render with ink, not blank).
const REAL_PDF_B64 =
  "JVBERi0xLjcKJYGBgYEKCjcgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCAzODMKPj4Kc3RyZWFtCniclZRNT8MwDIbv+RU5I204duw4EuKw0cGBC9Ab4oC28aVNaAjB38fZ2MpgHZ0iu27U5n3yKs7CDWoH/eChjxbRvz2644vp7GP6/jy+7w1eZ5NegqxRIWn2KL5+cBh9fensHxvBR/WM4Ou5O+GQWELCFIUTyjBlBEarQUZl9tTXL64+clXtrtxiJY1+HdvSOUUURRb1Ie5UNaaValEQYalM3VBMmYVkJJXlLEOLYES5zPwigL74dVyf2+Kf7vbO1p+4sr6AnzcFJVxWM3fT0Af2TdreAAKAAmcVH3D3Br5tiwWxKuiSi3VyhkABAat/RvlqSFDGLmv3wOXEYJaYWW1wlLEdDjvDBSJKB8IlOzxMJO3OkcR2OOoMh5Ro56HcA6eRISiEPc6RtMPFznDRvAuHwomdtxQ0aSscaDscd4Zjw9MD4VgxiiBRKxzqnoaQznBCSvyn03Vz0ZRO73PT6z8JAPx4vpkp+e9reZRsLWq3Adk2mqo8n5Y3xBc1PihBCmVuZHN0cmVhbQplbmRvYmoKCjkgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCAzMDcKPj4Kc3RyZWFtCnictdLLSsNAFAbg/TzFrIXWOfczIIKFFBduhLyAaBWlIhXx+T2p9dK0sxAJYZKQk+T/SP5NWvSpzCGXOcbi/PqQTi9X6/fV2+PtzWzxsr6bgbMLMphk5Nzfp2F/leKZ2CCzZ8GS++d0FvcUKyraKWs1P8/9U+pPUten67T5jML8tfajzN0rQFHKcDyF/TtFtu9nLJG0NFYxinMYcuNIcQ0Nw0Exq7rUzuiYBST/7PY51SoxV6wZ8LiGdpqdAAsBXWAZck0jVcxCwL9c268T82XMh0n3RxNacai1ijZRhcconBilVkgdVbmFIvMxiiZGGYloZbemSXBs4olNbs4FxACaKNQxSiZGVVWPv8GVmqhy0HOduucSPcfCzUahHdTcJjYBmhCiEzZRfFBz/xfqAyZQNxUKZW5kc3RyZWFtCmVuZG9iagoKMTAgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL09ialN0bQovTiA3Ci9GaXJzdCAzOQovTGVuZ3RoIDUzOAo+PgpzdHJlYW0KeJzVVN2L1EAMf+9fMY/6cEwm85WRZWE/FeTw2BMUxYdeOyyVpSO7XTn/ezPt7h3nVhTRBylpm8kvmcwvySgBAoUFoQUZYYTVJKxwyCI8eEFCAXkxmRTy7bcvUcibchsPhXzd1AfxkUEgNgzK70+FXKRj2wksptPi0WNRduUubYvBVagMPiNu9qk+VnEvJuvVeg3gAcAZFgeAS/4uWAILss42JP5n8eYkvOY1gJ6xbT2I84NPtvdYe/Jf8ZexLmOWA9bQoD/sm/daDTHwV/mEaSGvU70suyieLV8goIOACpUiYz48Zzr2sezS/3u4Pv8mtT894ZM6r1PbFfL2eNf1al5UhZyXh5gtQr6Ku6+xa6ryap52dSFXbZXqpt0K+a5pZ+2hOS/8Ydjfjpj7MHfjPrL/0I5yEw/puK+4PzOuj5x/nuZ85SEQs+op8Kj0fo+A4A06QuvyAP1gy9UlsIHcpS1wCY0LyMN2YfPWo9XajfmRsaAI1JgfOd7LK/IjuVhC4xxqfbYxN/L9m7vPserPnNXVfffytstVHxby2nWsm3Ke7nnqgR+DIGyweepnbZu6fBv0N0DbMa1Z86db4S9xzy1HFo3y9pJ7T0RBKZ6AMX6DNiZgGCmLB1IhBDtCLw8J847OmZGyaGtdMDTGvCcDynqlRjJxjrTWJoxkiZZTQTAjuyn0ViOSxn9csHC+xjepDxUgx/kOHjCN/wplbmRzdHJlYW0KZW5kb2JqCgoxMSAwIG9iago8PAovU2l6ZSAxMgovUm9vdCAyIDAgUgovSW5mbyAzIDAgUgovRmlsdGVyIC9GbGF0ZURlY29kZQovVHlwZSAvWFJlZgovTGVuZ3RoIDQ4Ci9XIFsgMSAyIDIgXQovSW5kZXggWyAwIDEyIF0KPj4Kc3RyZWFtCnicJckxEgAQEATBWecEIo/zdVV+gy1JJw2cU+hgZIoJU02K8bdJGxTzkQsukWgEhgplbmRzdHJlYW0KZW5kb2JqCgpzdGFydHhyZWYKMTQ5MwolJUVPRg==";

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

const ATTACH_OUT = [
  "C:\\Users\\demo\\AppData\\Local\\Temp\\pogopdf\\job\\report\\appendix-data.zip",
  "C:\\Users\\demo\\AppData\\Local\\Temp\\pogopdf\\job\\report\\chart.png",
  "C:\\Users\\demo\\AppData\\Local\\Temp\\pogopdf\\job\\report\\source-notes.txt",
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
    // Every option form state must show its CTA, even when the form overflows.
    if (name.endsWith("-form")) {
      await scrollCtaIntoView(page);
      // Framing guard: scrollCtaIntoView clamps its scroll so the Back action and
      // title can never leave the top of the frame. Asserting it here makes a
      // future over-scroll (or a control that scrolls the page as a side effect)
      // fail loudly instead of silently clipping the header.
      const framed = await page.evaluate(() => {
        const h1 = document.querySelector("h1");
        const back = [...document.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("←")
        );
        const cta = document.querySelector('[data-testid$="-cta"]');
        const top = (el) => (el ? el.getBoundingClientRect().top : null);
        const bottom = (el) => (el ? el.getBoundingClientRect().bottom : null);
        return {
          h1Top: top(h1),
          backTop: top(back),
          ctaBottom: bottom(cta),
          viewportHeight: window.innerHeight,
        };
      });
      if (framed.backTop !== null && framed.backTop < -1) {
        throw new Error(`${name}: Back clipped above the fold (${framed.backTop}px)`);
      }
      if (framed.h1Top !== null && framed.h1Top < -1) {
        throw new Error(`${name}: title clipped above the fold (${framed.h1Top}px)`);
      }
      if (
        framed.ctaBottom !== null &&
        framed.ctaBottom > framed.viewportHeight
      ) {
        // Geometry, not a regression: the form is taller than the space between
        // the page chrome and the fold. Kept as a warning so taller forms are
        // visible during review without failing the gate.
        console.warn(
          `    ! ${name}: CTA bottom ${framed.ctaBottom.toFixed(1)}px exceeds the ${framed.viewportHeight}px fold`
        );
      }
    }
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

    // --- PDF to SVG: dpi + pages + raster hint visible ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "PDF to SVG");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "pdftosvg-dpi", "300");
    await typeInto(page, "pdftosvg-pages", "2");
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

    // --- Images to PDF: 3 image cards, fit page size, margin 12 ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Images to PDF");
    await mock((p) => window.__mockDrop(p), IMAGES);
    await typeInto(page, "imagestopdf-margin", "12");
    await shot("imagestopdf-form");

    // --- Text to PDF: one .txt file, font size 14 ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Text to PDF");
    await mock((p) => window.__mockDrop(p), [TEXT_FILE]);
    await typeInto(page, "texttopdf-fontsize", "14");
    await shot("textpdf-form");

    // --- Markdown to PDF: one .md file, font size 12, simple hint ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Markdown to PDF");
    await mock((p) => window.__mockDrop(p), [MARKDOWN_FILE]);
    await typeInto(page, "markdowntopdf-fontsize", "12");
    await shot("markdown-form");

    // --- CSV to PDF: one .csv file, landscape ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "CSV to PDF");
    await mock((p) => window.__mockDrop(p), [CSV_FILE]);
    await clickLabel(page, "csvtopdf-orientation", "Landscape");
    await shot("csvtopdf-form");

    // --- Page Numbers: bottom-center, n-of-total, skip first ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Page Numbers");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickLabel(page, "pagenumbers-position", "Bottom center");
    await clickLabel(page, "pagenumbers-format", "1 / 5");
    await clickCheckbox(page, "pagenumbers-skipfirst");
    await shot("pagenumbers-form");

    // --- Watermark (text mode): text, opacity, rotation, tile ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Watermark");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "watermark-text", "CONFIDENTIAL");
    await typeInto(page, "watermark-opacity", "0.2");
    await typeInto(page, "watermark-rotation", "30");
    await clickLabel(page, "watermark-position", "Tile");
    await shot("watermark-text-form");

    // --- Watermark (image mode): text-only controls disappear ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Watermark");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickLabel(page, "watermark-mode", "Image");
    await clickTestId(page, "watermark-pick-image");
    await sleep(120);
    // The state is meaningless unless image mode really hid the text-only
    // controls and the picked image's name reached the picker button.
    const imageMode = await page.evaluate(() => ({
      picker: document.querySelector('[data-testid="watermark-pick-image"]')?.textContent?.trim() ?? null,
      textGone: !document.querySelector('[data-testid="watermark-text"]'),
      fontSizeGone: !document.querySelector('[data-testid="watermark-fontsize"]'),
      rotationGone: !document.querySelector('[data-testid="watermark-rotation"]'),
      colorGone: !document.querySelector('[data-testid="watermark-color"]'),
    }));
    if (
      !imageMode.picker ||
      imageMode.picker.includes("Choose") ||
      !imageMode.textGone ||
      !imageMode.fontSizeGone ||
      !imageMode.rotationGone ||
      !imageMode.colorGone
    ) {
      throw new Error(`watermark-image-form: image mode did not apply (${JSON.stringify(imageMode)})`);
    }
    await shot("watermark-image-form");

    // --- Crop: four insets, empty pages field ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Crop PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "crop-top", "10");
    await typeInto(page, "crop-bottom", "10");
    await typeInto(page, "crop-left", "20");
    await typeInto(page, "crop-right", "20");
    await shot("crop-form");

    // --- Header & Footer: header + footer text, Latin-1 hints ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Header & Footer");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "headerfooter-header", "Quarterly Report");
    await typeInto(page, "headerfooter-footer", "Page");
    await shot("headerfooter-form");

    // --- Edit Metadata: two fields filled, one clear-checkbox ticked ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Edit Metadata");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "editmetadata-title", "Quarterly Report");
    await typeInto(page, "editmetadata-author", "Ada Lovelace");
    await clickCheckbox(page, "editmetadata-subject-clear");
    await shot("editmetadata-form");

    // --- Protect: owner password filled, user empty, printing allowed ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Protect PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "protect-owner", "s3cret-owner");
    // Password inputs must stay masked: type=password never exposes the value.
    const protectMasked = await page.evaluate(() => {
      const owner = document.querySelector('[data-testid="protect-owner"]');
      const user = document.querySelector('[data-testid="protect-user"]');
      return {
        ownerType: owner?.getAttribute("type"),
        ownerValue: owner?.value,
        userType: user?.getAttribute("type"),
        userValue: user?.value,
      };
    });
    if (
      protectMasked.ownerType !== "password" ||
      protectMasked.ownerValue !== "s3cret-owner" ||
      protectMasked.userType !== "password" ||
      protectMasked.userValue !== ""
    ) {
      throw new Error(`protect-form: password fields not masked as expected (${JSON.stringify(protectMasked)})`);
    }
    await shot("protect-form");

    // --- Unlock: password filled ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Unlock PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "unlock-password", "document-pass");
    // Password inputs must stay masked: type=password never exposes the value.
    const unlockMasked = await page.evaluate(() => {
      const field = document.querySelector('[data-testid="unlock-password"]');
      return { type: field?.getAttribute("type"), value: field?.value };
    });
    if (unlockMasked.type !== "password" || unlockMasked.value !== "document-pass") {
      throw new Error(`unlock-form: password field not masked as expected (${JSON.stringify(unlockMasked)})`);
    }
    await shot("unlock-form");

    // --- Flatten: bare single-file card + hint ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Flatten PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await shot("flatten-form");

    // --- Remove Metadata: bare single-file card + hint ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Remove Metadata");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await shot("removemetadata-form");

    // --- Compare PDFs: 2 files → canned diff data card ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Compare PDFs");
    await mock((p) => window.__mockDrop(p), [SHORT[0], SHORT[1]]);
    await mock(() =>
      window.__mockSetDataResult("comparePdfs", {
        pageCountA: 12,
        pageCountB: 12,
        samePageCounts: true,
        differingPages: [2],
        pageSizeMismatchPages: [],
      })
    );
    await clickTestId(page, "comparePdfs-cta");
    await sleep(300);
    // The result card is the point of this state: require the canned diff to
    // have rendered (5 rows) and the "Differing pages" row to carry page 2.
    const compareRows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="data-row"]')].map(
        (r) => r.textContent?.replace(/\s+/g, " ").trim() ?? ""
      )
    );
    const differing = compareRows
      .find((r) => r.startsWith("Differing pages"))
      ?.replace("Differing pages", "")
      .trim();
    if (compareRows.length !== 5 || differing !== "2") {
      throw new Error(`compare-view: canned diff card missing (${JSON.stringify(compareRows)})`);
    }
    // The similarity caveat must reach the result view (not just the pick phase):
    // it is the whole point of the hint once a diff is on screen.
    const compareHint = await page.evaluate(
      () =>
        document
          .querySelector('[data-testid="comparePdfs-footnote"]')
          ?.textContent?.trim() ?? null
    );
    if (!compareHint) {
      throw new Error("compare-view: similarity hint missing from the result card");
    }
    await shot("compare-view");
    await mock(() => window.__mockSetDataResult("comparePdfs", null));

    // --- PDFs to ZIP: 3 PDF cards, no options ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "PDFs to ZIP");
    await mock((p) => window.__mockDrop(p), SHORT);
    await shot("pdfstozip-form");

    // --- Rasterize: DPI 300 + hint ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Rasterize PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "rasterize-dpi", "300");
    await shot("rasterize-form");

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

    // Filter to the utility tools so their category label is in view.
    // Keyboard typing into a just-mounted autoFocus input is unreliable in
    // headless captures, so set the query through the DOM and verify it
    // actually landed before shooting (the state is meaningless otherwise).
    // React overrides the native value setter, so clear its _valueTracker
    // before setting or React will swallow the change event.
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="palette-input"]');
      if (!(input instanceof HTMLInputElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      input._valueTracker?.setValue?.("");
      setter?.call(input, "metadata");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return input.value === "metadata";
    });
    await sleep(150);
    await shot("palette-utility");
    // Assert the palette panel itself shows the filtered rows WITH a category
    // label (the home grid underneath still lists every tool, so scope to the
    // panel). "metadata" now matches tools across categories (View Metadata is
    // utility, Edit/Remove Metadata are not), so require at least one row per
    // category label rather than "all utility".
    const filtered = await page.evaluate(() => {
      const panel = document
        .querySelector('[data-testid="palette-input"]')
        ?.closest("div");
      const rows = panel ? [...panel.querySelectorAll("button")] : [];
      const hasUtility = rows.some((b) => b.textContent?.includes("Utility"));
      const hasOther = rows.some(
        (b) =>
          b.textContent?.includes("Edit") || b.textContent?.includes("Secure")
      );
      return rows.length > 0 && hasUtility && hasOther;
    });
    if (!filtered) {
      throw new Error(
        "palette-utility: filter did not apply, or category labels missing"
      );
    }

    // --- settings ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await clickAria(page, "Settings");
    await sleep(150);
    await shot("settings");

    // --- Office to PDF: docx via the office picker + formats hint ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Office to PDF");
    await clickTestId(page, "officeToPdf-dropzone");
    await sleep(200);
    // The office picker must return the canned docx (not the PDF default).
    const officeCard = await page.evaluate(
      () =>
        document.querySelector('[data-testid="officeToPdf-file-name"]')?.textContent?.trim() ?? null
    );
    if (officeCard !== "quarterly-report.docx") {
      throw new Error(`office-form: office picker did not queue the docx (${officeCard})`);
    }
    await shot("office-form");

    // --- Ebook to PDF: epub + font size 14 + margins ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Ebook to PDF");
    await clickTestId(page, "ebookToPdf-dropzone");
    await sleep(200);
    const ebookCard = await page.evaluate(
      () =>
        document.querySelector('[data-testid="ebookToPdf-file-name"]')?.textContent?.trim() ?? null
    );
    if (!ebookCard || !ebookCard.endsWith(".epub")) {
      throw new Error(`ebook-form: ebook picker did not queue the epub (${ebookCard})`);
    }
    await typeInto(page, "ebook-fontsize", "14");
    await typeInto(page, "ebook-margins", "90");
    await shot("ebook-form");

    // --- Comic to PDF: cbz + hint ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Comic to PDF");
    await clickTestId(page, "comicToPdf-dropzone");
    await sleep(200);
    const comicCard = await page.evaluate(
      () =>
        document.querySelector('[data-testid="comicToPdf-file-name"]')?.textContent?.trim() ?? null
    );
    if (!comicCard || !comicCard.endsWith(".cbz")) {
      throw new Error(`comic-form: comic picker did not queue the cbz (${comicCard})`);
    }
    await shot("comic-form");

    // --- OCR: Japanese, DPI 300, searchable checked, Latin hint ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "OCR PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await selectByValue(page, "ocr-language", "jpn");
    await typeInto(page, "ocr-dpi", "300");
    await shot("ocr-form");

    // --- OCR done with dropped searchable lines → warning banner ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "OCR PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await mock(() => window.__mockJobControl("hold"));
    await clickTestId(page, "ocr-cta");
    await sleep(100);
    await mock(() =>
      window.__mockProgress({ percent: 100, stage: "ocr.droppedLines", pagesDone: 3 })
    );
    await sleep(120);
    await mock(() => window.__mockResolveJob());
    await sleep(300);
    await mock(() => window.__mockJobControl("auto"));
    // The warning banner is the whole point: its text must be on the done card.
    const ocrWarning = await page.evaluate(
      () => document.querySelector('[data-testid="ocr-warning"]')?.textContent?.trim() ?? null
    );
    if (!ocrWarning) {
      throw new Error("ocr-warning: the dropped-lines warning banner did not render");
    }
    await shot("ocr-warning");

    // --- Extract Tables: markdown + pages 1-2 + hint ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Extract Tables");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickLabel(page, "extracttables-format", "Markdown");
    await typeInto(page, "extracttables-pages", "1-2");
    await shot("tables-form");

    // --- PDF to Markdown: pages + approximation hint ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "PDF to Markdown");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "pdftomarkdown-pages", "1-3");
    await shot("pdftomarkdown-form");

    // --- Prepare for AI: pages 2 ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Prepare for AI");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "prepareai-pages", "2");
    await shot("prepareai-form");

    // --- Add Attachments: PDF card + 2 attachment rows ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Add Attachments");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickTestId(page, "addAttachments-add");
    await sleep(150);
    const attachmentRows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="data-row"]')].map(
        (r) => r.textContent?.replace(/\s+/g, " ").trim() ?? ""
      )
    );
    if (attachmentRows.length !== 2) {
      throw new Error(
        `attachments-add-form: expected 2 attachment rows (${JSON.stringify(attachmentRows)})`
      );
    }
    await shot("attachments-add-form");

    // --- Extract Attachments done: 3 outputs → Save All rows ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Extract Attachments");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await mock((p) => window.__mockSetOutputPaths(p), ATTACH_OUT);
    await mock(() => window.__mockJobControl("auto"));
    await clickTestId(page, "extractAttachments-cta");
    await sleep(400);
    await clickTestId(page, "save-all");
    await sleep(400);
    await shot("attachments-extract-done");
    await mock(() => window.__mockSetOutputPaths(null));

    // --- Remove Attachments: loaded list with one box ticked ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Remove Attachments");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickTestId(page, "editAttachments-load");
    await sleep(200);
    await clickTestId(page, "editAttachments-check-appendix-data.zip");
    await sleep(120);
    const editAttachmentRows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="data-row"]')].map((r) => {
        const box = r.querySelector('input[type="checkbox"]');
        return { text: r.textContent?.replace(/\s+/g, " ").trim() ?? "", checked: box?.checked ?? null };
      })
    );
    if (
      editAttachmentRows.length !== 2 ||
      editAttachmentRows.filter((r) => r.checked).length !== 1
    ) {
      throw new Error(
        `attachments-edit-view: expected 2 rows with 1 ticked (${JSON.stringify(editAttachmentRows)})`
      );
    }
    await shot("attachments-edit-view");

    // --- View Bookmarks: nested outline tree ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "View Bookmarks");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickTestId(page, "viewBookmarks-cta");
    await sleep(300);
    const bookmarkDepths = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="bookmark-row"]')].map((r) =>
        Number(r.getAttribute("data-depth") ?? "0")
      )
    );
    const hasDepth = (d) => bookmarkDepths.includes(d);
    if (!hasDepth(0) || !hasDepth(1) || !hasDepth(2)) {
      throw new Error(
        `bookmarks-view: canned tree did not render with nesting (${JSON.stringify(bookmarkDepths)})`
      );
    }
    await shot("bookmarks-view");

    // --- Edit Bookmarks: auto-loaded flat rows + add + hints ---
    // Load a compact outline so the form (rows + add button + hints + CTA) stays
    // inside the viewport; the full tree is the point of bookmarks-view instead.
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Edit Bookmarks");
    await mock(() =>
      window.__mockSetDataResult("viewBookmarks", {
        bookmarks: [
          { title: "Introduction", page: 1, children: [] },
          { title: "Method", page: 5, children: [] },
          { title: "Conclusion", page: 12, children: [] },
        ],
      })
    );
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await sleep(400);
    const editBookmarkRows = await page.evaluate(
      () => document.querySelectorAll('[data-testid="data-row"]').length
    );
    if (editBookmarkRows !== 3) {
      throw new Error(
        `bookmarks-edit-form: expected the compact outline auto-loaded as 3 rows (got ${editBookmarkRows})`
      );
    }
    await shot("bookmarks-edit-form");
    await mock(() => window.__mockSetDataResult("viewBookmarks", null));

    // --- Table of Contents: after-cover + default title + both hints ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Table of Contents");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickLabel(page, "toc-position", "After the first page");
    await shot("toc-form");

    // ===== Phase 3 editor family =====

    // --- PDF Editor: real blob-backed 2-page PDF (same seam as organize-grid-real) ---
    // The editor renders page 1 through pdf.js; the tool rail and page chrome
    // frame the canvas.
    const loadEditorPdf = async () => {
      await page.evaluate((b64) => {
        const bin = atob(b64);
        const bytes = new Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        window.__mockSetFiles([window.__mockBlobPath(bytes)]);
      }, REAL_PDF_B64);
      await clickTestId(page, "editor-dropzone");
      await page.waitForSelector('[data-testid="editor-page-bitmap"]', { timeout: 8000 });
      // The bitmap <img> must finish decoding before capture: the ink check
      // samples the decoded pixels, not just the element's presence.
      await page.waitForFunction(
        () => {
          const img = document.querySelector('[data-testid="editor-page-bitmap"]');
          return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
        },
        { timeout: 8000 }
      );
      await sleep(300);
    };
    // Page box in viewport coords; annotation drags are fractions of it so the
    // gestures stay readable at any zoom.
    const editorPageBox = () =>
      page.evaluate(() => {
        const r = document.querySelector('[data-testid="editor-page"]').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
    const drawOnPage = async (tool, fx1, fy1, fx2, fy2) => {
      const b = await editorPageBox();
      await clickTestId(page, `editor-tool-${tool}`);
      await sleep(80);
      await page.mouse.move(b.x + b.width * fx1, b.y + b.height * fy1);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * fx2, b.y + b.height * fy2, { steps: 8 });
      await page.mouse.up();
      await sleep(120);
    };
    // Drop selection: switch to Select (and let React commit the tool change,
    // otherwise the pointerdown still runs the previous draw tool and leaves
    // the mark selected), then click a spot with no mark.
    const clearEditorSelection = async (fx, fy) => {
      // Let the last draw commit before switching tools: a pending addItem
      // update would otherwise land after the deselect and restore the mark.
      await sleep(200);
      await clickTestId(page, "editor-tool-select");
      await sleep(200);
      // The editor canvas scrolls, and a tool that adds a footer (the redact
      // warning) shrinks it, so clamp the click to the visible canvas box
      // instead of trusting a raw page fraction (a page taller than the canvas
      // would otherwise put the click below the canvas and outside the editor).
      const b = await editorPageBox();
      const c = await page.evaluate(() => {
        const r = document.querySelector('[data-testid="editor-canvas"]').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const targetX = b.x + b.width * fx;
      const targetY = Math.min(b.y + b.height * fy, c.y + c.height - 12);
      if (targetX >= c.x && targetX <= c.x + c.width && targetY >= c.y) {
        await page.mouse.click(targetX, targetY);
        await sleep(200);
      }
    };

    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "PDF Editor");
    await loadEditorPdf();
    await shot("editor-open");

    // --- Editor: rect + highlight + free text on the real page ---
    await drawOnPage("rect", 0.15, 0.08, 0.55, 0.18);
    await drawOnPage("highlight", 0.15, 0.3, 0.62, 0.36);
    {
      const b = await editorPageBox();
      await clickTestId(page, "editor-tool-freetext");
      await page.mouse.click(b.x + b.width * 0.15, b.y + b.height * 0.25);
      await sleep(150);
      await typeInto(page, "editor-text-input", "Reviewed by A. Lovelace");
      await page.keyboard.press("Enter");
      await sleep(150);
    }
    await clearEditorSelection(0.8, 0.55);
    await shot("editor-annotated");

    // --- Editor: a marked redaction (hatch + warning) ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "PDF Editor");
    await loadEditorPdf();
    await drawOnPage("redact", 0.2, 0.1, 0.6, 0.2);
    await clearEditorSelection(0.8, 0.55);
    const redactSeen = await page.evaluate(() => ({
      mark: document.querySelector('[data-testid="editor-redact-mark"]') !== null,
      hint: document.querySelector('[data-testid="editor-redact-hint"]') !== null,
    }));
    if (!redactSeen.mark || !redactSeen.hint) {
      throw new Error(`editor-redact-marked: redaction mark/warning missing (${JSON.stringify(redactSeen)})`);
    }
    {
      const handleCount = await page.evaluate(
        () => document.querySelectorAll('[data-testid^="editor-handle-"]').length
      );
      if (handleCount !== 0) {
        throw new Error(`editor-redact-marked: expected no resize handles (got ${handleCount})`);
      }
    }
    await shot("editor-redact-marked");

    // --- Editor: one mark selected (8 resize handles) ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "PDF Editor");
    await loadEditorPdf();
    await drawOnPage("rect", 0.2, 0.08, 0.6, 0.22);
    {
      // Re-select through the Select tool so the state reads as a user action.
      const b = await editorPageBox();
      await clickTestId(page, "editor-tool-select");
      await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.15);
      await sleep(150);
      const handleCount = await page.evaluate(
        () => document.querySelectorAll('[data-testid^="editor-handle-"]').length
      );
      if (handleCount !== 8) {
        throw new Error(`editor-selected: expected 8 resize handles (got ${handleCount})`);
      }
    }
    await shot("editor-selected");

    // --- Editor: search panel with canned matches + pulse on the page ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "PDF Editor");
    await loadEditorPdf();
    // The fixture page is small (about 200 x 300 pt at this zoom), so keep the
    // pulse origins well inside it; a 140pt-wide pulse near x=20 still fits.
    await mock(() =>
      window.__mockSetSearchResults([
        { page: 1, snippet: "…quarterly revenue reconciliation…", x: 20, y: 60 },
        { page: 2, snippet: "…appendix and audit notes…", x: 30, y: 120 },
      ])
    );
    await clickTestId(page, "editor-search-toggle");
    await sleep(120);
    await typeInto(page, "editor-search-input", "revenue");
    await clickTestId(page, "editor-search-run");
    await sleep(300);
    await clickTestId(page, "editor-search-result");
    await sleep(150);
    await shot("editor-search-results");

    // --- Fill Form: canned fields (text + checkbox + dropdown + radio + readOnly) ---
    const FORM_FIELDS = {
      fields: [
        { name: "fullName", type: "text", value: "", readOnly: false, required: true },
        { name: "agree", type: "checkbox", value: "false", readOnly: false, required: false },
        {
          name: "department", type: "dropdown", value: "",
          options: ["Engineering", "Sales", "Support"], readOnly: false, required: false,
        },
        {
          name: "plan", type: "radio", value: "",
          options: ["Basic", "Pro"], readOnly: false, required: false,
        },
        { name: "accountId", type: "text", value: "ACC-1024", readOnly: true, required: false },
      ],
    };
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Fill Form");
    await mock((d) => window.__mockSetDataResult("formFields", d), FORM_FIELDS);
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await sleep(400);
    const formFieldCount = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="formfill-field-"]').length
    );
    if (formFieldCount < 5) {
      throw new Error(`formfill-form: the canned fields did not render (got ${formFieldCount})`);
    }
    await shot("formfill-form");

    // --- Fill Form: values entered across the widget types ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Fill Form");
    await mock((d) => window.__mockSetDataResult("formFields", d), FORM_FIELDS);
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await sleep(400);
    await typeInto(page, "formfill-field-fullName", "Ada Lovelace");
    await clickCheckbox(page, "formfill-field-agree");
    await selectByValue(page, "formfill-field-department", "Engineering");
    await clickCheckbox(page, "formfill-field-plan-Pro");
    {
      const filled = await page.evaluate(() => {
        const q = (tid) => document.querySelector(`[data-testid="${tid}"]`);
        return {
          text: q("formfill-field-fullName")?.value,
          checkbox: q("formfill-field-agree")?.checked,
          dropdown: q("formfill-field-department")?.value,
          radio: q("formfill-field-plan-Pro")?.checked,
          readOnlyDisabled: q("formfill-field-accountId")?.disabled,
        };
      });
      if (
        filled.text !== "Ada Lovelace" ||
        filled.checkbox !== true ||
        filled.dropdown !== "Engineering" ||
        filled.radio !== true ||
        filled.readOnlyDisabled !== true
      ) {
        throw new Error(`formfill-filled: entered values wrong (${JSON.stringify(filled)})`);
      }
    }
    await shot("formfill-filled");

    // --- Fill Form: an empty form (honest empty state, no CTA) ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Fill Form");
    await mock(() => window.__mockSetDataResult("formFields", { fields: [] }));
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await sleep(400);
    const emptyState = await page.evaluate(() => ({
      empty: document.querySelector('[data-testid="formfill-empty"]') !== null,
      cta: document.querySelector('[data-testid="formFill-cta"]') !== null,
    }));
    if (!emptyState.empty || emptyState.cta) {
      throw new Error(`formfill-empty: empty state wrong (${JSON.stringify(emptyState)})`);
    }
    await shot("formfill-empty");
    await mock(() => window.__mockSetDataResult("formFields", null));

    // --- Create Form: three field rows with coordinates ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Create Form");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickTestId(page, "formcreate-add");
    await clickTestId(page, "formcreate-add");
    await clickTestId(page, "formcreate-add");
    await typeInto(page, "formcreate-name-0", "firstName");
    await typeInto(page, "formcreate-label-0", "First name");
    await typeInto(page, "formcreate-name-1", "email");
    await typeInto(page, "formcreate-label-1", "Email");
    await typeInto(page, "formcreate-name-2", "agree");
    await typeInto(page, "formcreate-label-2", "Agree");
    await selectByValue(page, "formcreate-type-2", "checkbox");
    await scrollCtaIntoView(page);
    await shot("formcreate-placed");

    // --- Sign PDF: Draw mode with ink on the pad ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Sign PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await sleep(120);
    await scrollCtaIntoView(page);
    {
      const pad = await page.evaluate(() => {
        const r = document.querySelector('[data-testid="sign-pad"]').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const pt = (fx, fy) => ({ x: pad.x + pad.width * fx, y: pad.y + pad.height * fy });
      const a = pt(0.1, 0.7);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (const [fx, fy] of [[0.25, 0.3], [0.4, 0.7], [0.55, 0.25], [0.7, 0.6], [0.85, 0.35]]) {
        const p = pt(fx, fy);
        await page.mouse.move(p.x, p.y, { steps: 4 });
      }
      await page.mouse.up();
      await sleep(150);
    }
    await shot("sign-draw");

    // --- Sign PDF: Type mode with text entered ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Sign PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickLabel(page, "sign-mode", "Type");
    await sleep(120);
    await typeInto(page, "sign-text", "Ada Lovelace");
    await scrollCtaIntoView(page);
    await shot("sign-type");

    // --- Stamp PDF: text + colour + rotation filled ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Stamp PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "stamp-text", "APPROVED");
    await typeInto(page, "stamp-color", "#1D4ED8");
    await typeInto(page, "stamp-rotate", "15");
    await shot("stamp-form");

    // --- Remove Annotations: three types ticked, All types off ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Remove Annotations");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickCheckbox(page, "removeannotations-type-highlight");
    await clickCheckbox(page, "removeannotations-type-underline");
    await clickCheckbox(page, "removeannotations-type-rect");
    await sleep(120);
    const annotChecks = await page.evaluate(() => {
      const all = document.querySelector('[data-testid="removeannotations-all"]');
      const types = ["highlight", "underline", "rect"].map(
        (t) => document.querySelector(`[data-testid="removeannotations-type-${t}"]`)?.checked ?? null
      );
      return { all: all?.checked ?? null, types, allDisabled: all?.disabled ?? null };
    });
    if (annotChecks.all !== false || annotChecks.types.some((v) => v !== true)) {
      throw new Error(`removeannotations-form: checkbox state wrong (${JSON.stringify(annotChecks)})`);
    }
    await shot("removeannotations-form");

    // --- Sanitize PDF: the default five-checkbox state (all on) ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Sanitize PDF");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await sleep(120);
    const sanitizeChecks = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="sanitize-"]')]
        .filter((el) => el.tagName === "INPUT")
        .map((el) => el.checked)
    );
    if (sanitizeChecks.length !== 5 || sanitizeChecks.some((c) => c !== true)) {
      throw new Error(`sanitize-form: expected 5 checked flags (${JSON.stringify(sanitizeChecks)})`);
    }
    await shot("sanitize-form");

    // --- Bates Numbering: position + format + prefix ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Bates Numbering");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await clickLabel(page, "bates-position", "Bottom right");
    await clickLabel(page, "bates-format", "1 / 5");
    await typeInto(page, "bates-prefix", "ACME-");
    await shot("bates-form");

    // --- Page Labels: Roman style + prefix ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Page Labels");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await selectByValue(page, "pagelabels-style", "roman-upper");
    await typeInto(page, "pagelabels-prefix", "Appendix-");
    await shot("pagelabels-form");

    // --- Remove Blank Pages: tolerance moved off the default ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Remove Blank Pages");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "removeblankpages-tolerance", "15");
    await sleep(120);
    await shot("removeblank-form");

    // --- Remove Restrictions: password filled and masked ---
    await setPrefs(page, { "pogopdf.theme": "light", "pogopdf.lang": "en" });
    await openTool(page, "Remove Restrictions");
    await mock((p) => window.__mockDrop(p), [SHORT[0]]);
    await typeInto(page, "removerestrictions-password", "document-pass");
    const restrictionsMasked = await page.evaluate(() => {
      const f = document.querySelector('[data-testid="removerestrictions-password"]');
      return { type: f?.getAttribute("type"), value: f?.value };
    });
    if (restrictionsMasked.type !== "password" || restrictionsMasked.value !== "document-pass") {
      throw new Error(`restrictions-form: password not masked (${JSON.stringify(restrictionsMasked)})`);
    }
    await shot("restrictions-form");
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
