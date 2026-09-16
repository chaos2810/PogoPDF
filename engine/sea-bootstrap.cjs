// SEA entry point. The single-executable `require` resolves only built-ins
// (NODE_PATH/cwd are ignored), so it cannot load the real bundle's externals.
// This bootstrap locates the extracted dependency directory and loads
// `engine.cjs` from disk through a `createRequire` anchored there; once the
// bundle is loaded by Node's normal loader, its `require("sharp")` /
// `require("@napi-rs/canvas")` calls resolve from the sibling `node_modules`.
"use strict";

const { createRequire } = require("node:module");
const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const hasEngine = (dir) => dir && existsSync(join(dir, "engine.cjs"));

// In SEA, __dirname is the directory holding the executable. The Rust launcher
// extracts engine-<hash>.exe and engine-deps-<hash>/ as siblings there, so the
// deps dir can be found next to the exe regardless of the spawn cwd.
function siblingDepsDir() {
  let entries;
  try {
    entries = readdirSync(__dirname);
  } catch {
    return null;
  }
  const match = entries.find(
    (name) => name.startsWith("engine-deps") && hasEngine(join(__dirname, name))
  );
  return match ? join(__dirname, match) : null;
}

function resolveDepsDir() {
  const candidates = [
    siblingDepsDir(),
    process.env.POGOPDF_ENGINE_DEPS,
    process.cwd(),
  ];
  for (const dir of candidates) {
    if (hasEngine(dir)) return dir;
  }
  throw new Error(
    "PogoPDF engine: cannot locate engine-deps (looked in: " +
      candidates.filter(Boolean).join(", ") +
      ")"
  );
}

const depsDir = resolveDepsDir();
const enginePath = join(depsDir, "engine.cjs");
// Anchor resolution at the deps dir so the bundle's own requires (and pdf.js's
// internal createRequire calls) walk the staged node_modules.
createRequire(enginePath)(enginePath);
