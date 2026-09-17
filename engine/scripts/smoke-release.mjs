// Smoke-test a staged release engine: ping, a pdfToImages job, and a
// protect -> unlock roundtrip backed by the staged qpdf, end-to-end.
//
// Usage: node engine/scripts/smoke-release.mjs <engine.exe> <fixture.pdf>
// The engine is run against the sibling engine-deps-<id>/ directory (the same
// layout src-tauri produces), so this exercises the SEA bootstrap, the native
// module resolution, and the release qpdf layout (deps/qpdf/) without building
// the whole app.
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { PDFDocument } from "pdf-lib";

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
const qpdfExe = join(deps, "qpdf", "qpdf.exe");
if (!statSync(qpdfExe, { throwIfNoEntry: false })?.isFile()) {
  console.error(`missing staged qpdf at ${qpdfExe}`);
  process.exit(2);
}

const child = spawn(exe, [], { cwd: deps, stdio: ["pipe", "pipe", "pipe"] });
let out = "";
let err = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (err += d));

const timer = setTimeout(() => {
  console.error("TIMEOUT\n" + out + "\n" + err);
  child.kill();
  process.exit(1);
}, 120000);

// Line-oriented JSON-RPC client: each request gets an id, and the matching
// response is resolved from the engine's stdout stream.
const pending = new Map();
let nextId = 1;
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});

const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (msg) => {
      if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

const uuid = (n) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;

async function main() {
  const pong = await request("engine.ping");
  if (pong?.pong !== true) throw new Error("engine.ping did not return {pong:true}");

  const raster = await request("job.start", {
    jobId: uuid(1),
    toolId: "pdfToImages",
    input: { filePath: fixture, format: "png", dpi: 72 },
  });
  for (const p of raster.outputPaths ?? []) {
    if (readFileSync(p).subarray(0, 4).toString("hex") !== "89504e47") {
      throw new Error("bad PNG magic: " + p);
    }
    if (!statSync(p).size) throw new Error("empty output: " + p);
  }
  if (!raster.outputPaths?.length) throw new Error("no raster output paths");

  // qpdf-backed roundtrip: protect with a user password, then unlock it. This
  // proves the staged qpdf (exe + DLLs under deps/qpdf/) resolves from the
  // release spawn cwd; a lone exe would crash before writing the output.
  const source = await PDFDocument.load(readFileSync(fixture));
  const protectedResult = await request("job.start", {
    jobId: uuid(2),
    toolId: "protect",
    input: {
      filePath: fixture,
      userPassword: "smoke-user",
      ownerPassword: "smoke-owner",
      allowPrinting: true,
      allowCopying: true,
    },
  });
  const protectedPath = protectedResult.outputPath;
  if (!protectedPath?.endsWith("protected.pdf")) {
    throw new Error("protect did not return protected.pdf: " + protectedPath);
  }
  if (readFileSync(protectedPath).subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("protected output is not a PDF: " + protectedPath);
  }
  const loadProtected = await PDFDocument.load(readFileSync(protectedPath)).then(
    () => true,
    () => false
  );
  if (loadProtected) throw new Error("protected output loaded without a password");

  const unlockedResult = await request("job.start", {
    jobId: uuid(3),
    toolId: "unlock",
    input: { filePath: protectedPath, password: "smoke-user" },
  });
  const unlockedPath = unlockedResult.outputPath;
  if (!unlockedPath?.endsWith("unlocked.pdf")) {
    throw new Error("unlock did not return unlocked.pdf: " + unlockedPath);
  }
  const unlocked = await PDFDocument.load(readFileSync(unlockedPath));
  if (unlocked.getPageCount() !== source.getPageCount()) {
    throw new Error(
      `unlocked page count ${unlocked.getPageCount()} != source ${source.getPageCount()}`
    );
  }

  if (err.trim()) throw new Error("stderr not clean: " + err.trim());
  console.log(
    `PASS: ping + pdfToImages (${raster.outputPaths.length} page(s)) + protect/unlock ` +
      `roundtrip (${unlocked.getPageCount()} page(s)) via ${depsName}`
  );
}

main().then(
  () => {
    clearTimeout(timer);
    child.kill();
    process.exit(0);
  },
  (e) => {
    clearTimeout(timer);
    console.error("FAIL\n" + (e?.message ?? e) + (out || err ? "\n" + out + "\n" + err : ""));
    child.kill();
    process.exit(1);
  }
);
