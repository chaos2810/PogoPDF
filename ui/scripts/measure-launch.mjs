// Measures PogoPDF launch times: fresh-cache (first) and warm-cache (second).
// Usage: node ui/scripts/measure-launch.mjs <path-to-pogopdf.exe>
// Polls every 100 ms for both the app process and the extracted engine child;
// prints ms from Start-Process to "both visible" for each run.

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const exe = process.argv[2];
if (!exe || !existsSync(exe)) {
  console.error("usage: node ui/scripts/measure-launch.mjs <pogopdf.exe>");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listProcs() {
  return new Promise((resolve) => {
    const out = [];
    const tasklist = spawn("tasklist", ["/FO", "CSV", "/NH"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    tasklist.stdout.on("data", (d) => out.push(d));
    tasklist.stdout.on("end", () => {
      const text = Buffer.concat(out).toString();
      const names = new Set();
      for (const line of text.split("\n")) {
        const m = /^"([^"]+)"/.exec(line.trim());
        if (m) names.add(m[1].toLowerCase());
      }
      resolve(names);
    });
    tasklist.on("error", () => resolve(new Set()));
  });
}

async function waitBoth(timeoutMs) {
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  for (;;) {
    const names = await listProcs();
    const app = [...names].some((n) => n.startsWith("pogopdf"));
    const engine = [...names].some((n) => /^engine-/.test(n));
    if (app && engine) return Date.now() - t0;
    if (Date.now() > deadline) return -1;
    await sleep(100);
  }
}

async function closeApp() {
  const names = await listProcs();
  const app = [...names].find((n) => n.startsWith("pogopdf"));
  if (!app) return;
  spawn("taskkill", ["/IM", "pogopdf.exe", "/IM", `${app}.exe`], {
    stdio: "ignore",
  });
  // Try a graceful close first; force after a grace period.
  spawn("powershell", [
    "-NoProfile",
    "-Command",
    "Get-Process pogopdf -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() }",
  ], { stdio: "ignore" });
  await sleep(3000);
  spawn("powershell", [
    "-NoProfile",
    "-Command",
    "Get-Process pogopdf -ErrorAction SilentlyContinue | Stop-Process -Force",
  ], { stdio: "ignore" });
  await sleep(2000);
}

const cache = join(
  process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
  "PogoPDF",
  "bin"
);

async function main() {
  // Run 1: fresh cache (wipe the runtime extraction dir).
  if (existsSync(cache)) {
    console.log("wiping", cache);
    rmSync(cache, { recursive: true, force: true });
  }
  spawn(exe, [], { detached: true, stdio: "ignore" });
  const first = await waitBoth(120000);
  console.log(`first launch (fresh cache): ${first} ms`);
  await closeApp();

  // Run 2: warm cache.
  spawn(exe, [], { detached: true, stdio: "ignore" });
  const second = await waitBoth(30000);
  console.log(`second launch (warm cache): ${second} ms`);
  await closeApp();

  const names = await listProcs();
  const zombies = [...names].filter((n) => /pogopdf|engine-|soffice/.test(n));
  console.log(zombies.length === 0 ? "no zombies" : `ZOMBIES: ${zombies.join(", ")}`);
  process.exit(first > 0 && second > 0 && zombies.length === 0 ? 0 : 1);
}

main();