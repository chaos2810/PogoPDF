// Smoke-test a staged release engine: ping + a pdfToImages job end-to-end.
//
// Usage: node engine/scripts/smoke-release.mjs <engine.exe> <fixture.pdf>
// The engine is run against the sibling engine-deps-<id>/ directory (the same
// layout src-tauri produces), so this exercises the SEA bootstrap and the
// native module resolution without building the whole app.
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const [exe, fixture] = process.argv.slice(2);
if (!exe || !fixture) {
  console.error("usage: node smoke-release.mjs <engine.exe> <fixture.pdf>");
  process.exit(2);
}

const dir = dirname(exe);
const depsName = readdirSync(dir).find(
  (name) => name.startsWith("engine-deps-") && !name.endsWith(".tmp")
);
if (!depsName) {
  console.error(`no engine-deps-* directory beside ${exe}`);
  process.exit(2);
}
const deps = join(dir, depsName);

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
  const result = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .find((m) => m && m.id === 2);
  if (!result) return;

  clearTimeout(timer);
  clearInterval(tick);
  const failed = [];
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
