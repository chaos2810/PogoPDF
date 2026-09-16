// Smoke-test a staged release engine: ping + a pdfToImages job end-to-end.
//
// Usage: node engine/scripts/smoke-release.mjs <engine.exe> <fixture.pdf>
// The engine is run against the sibling engine-deps-<id>/ directory (the same
// layout src-tauri produces), so this exercises the SEA bootstrap and the
// native module resolution without building the whole app.
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const [exe, fixture] = process.argv.slice(2);
if (!exe || !fixture) {
  console.error("usage: node smoke-release.mjs <engine.exe> <fixture.pdf>");
  process.exit(2);
}

const dir = dirname(exe);
// Derive the deps dir from the exe basename (engine-<id>.exe -> engine-deps-<id>):
// the same rule the SEA bootstrap uses, so the smoke test can never pair a stale
// engine with a fresh deps tree (or vice versa) that happens to sit beside it.
const exeName = basename(exe);
const idMatch = /^engine-(.+)\.exe$/.exec(exeName);
if (!idMatch) {
  console.error(`engine exe must be named engine-<id>.exe (got ${exeName})`);
  process.exit(2);
}
const depsName = `engine-deps-${idMatch[1]}`;
const deps = join(dir, depsName);
if (!statSync(deps, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`missing deps directory ${deps}`);
  process.exit(2);
}

const child = spawn(exe, [], { cwd: deps, stdio: ["pipe", "pipe", "pipe"] });
let out = "";
let err = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (err += d));

const jobId = "11111111-1111-4111-8111-111111111111";
child.stdin.write(
  JSON.stringify({ jsonrpc: "2.0", id: 1, method: "engine.ping" }) + "\n"
);
child.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "job.start",
    params: {
      jobId,
      toolId: "pdfToImages",
      input: { filePath: fixture, format: "png", dpi: 72 },
    },
  }) + "\n"
);

const timer = setTimeout(() => {
  console.error("TIMEOUT\n" + out + "\n" + err);
  child.kill();
  process.exit(1);
}, 60000);

const tick = setInterval(() => {
  const lines = out.split("\n").filter(Boolean);
  const parsed = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  });
  const result = parsed.find((m) => m && m.id === 2);
  if (!result) return;

  clearTimeout(timer);
  clearInterval(tick);
  const failed = [];
  // Assert the ping reply explicitly: a dead/foreign engine that answers the
  // job but not ping (or vice versa) must fail the smoke test.
  const pong = parsed.find((m) => m && m.id === 1);
  if (!pong || pong.result?.pong !== true) {
    failed.push("engine.ping did not return {pong:true}: " + JSON.stringify(pong));
  }
  if (result.error) failed.push("job error: " + JSON.stringify(result.error));
  else {
    for (const p of result.result.outputPaths ?? []) {
      const magic = readFileSync(p).subarray(0, 4);
      if (magic.toString("hex") !== "89504e47") failed.push("bad PNG magic: " + p);
      if (!statSync(p).size) failed.push("empty output: " + p);
    }
    if (!result.result.outputPaths?.length) failed.push("no output paths");
  }
  if (err.trim()) failed.push("stderr not clean: " + err.trim());
  if (failed.length) {
    console.error("FAIL\n" + failed.join("\n"));
    child.kill();
    process.exit(1);
  }
  console.log("PASS: ping + pdfToImages rasterized " +
    result.result.outputPaths.length + " page(s) via " + depsName);
  child.kill();
  process.exit(0);
}, 100);
