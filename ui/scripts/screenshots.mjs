// Visual verification harness for the UI. Captures the app in a real browser
// against the dev-only Tauri mock (ui/src/dev/mock-tauri.ts, loaded via ?mock=1).
//
// Usage: npm run shots   (from the repo root, or `npm run shots -w @pogopdf/ui`)
//
// Starts Vite itself when nothing is listening on the dev port and tears it
// down afterwards; reuses an already-running dev server otherwise.
// Requires a local Chromium browser: Edge (preferred) or Chrome. No browser is
// downloaded — puppeteer-core drives the system binary.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

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

async function clickAria(page, label) {
  const ok = await page.evaluate((l) => {
    const btn = document.querySelector(`button[aria-label="${l}"]`);
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
  if (!ok) throw new Error(`No button with aria-label "${label}"`);
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
  const shot = async (name) => {
    await page.screenshot({ path: join(shotsDir, `${name}.png`) });
    console.log(`  ✓ ${name}.png`);
  };
  const mock = (fn, ...args) => page.evaluate(fn, ...args);

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

  console.log(`\nScreenshots written to ${shotsDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
