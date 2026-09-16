// SEA entry point. The single-executable `require` resolves only built-ins
// (NODE_PATH/cwd are ignored), so it cannot load the real bundle's externals.
// This bootstrap locates the extracted dependency directory and loads
// `engine.cjs` from disk through a `createRequire` anchored there; once the
// bundle is loaded by Node's normal loader, its `require("sharp")` /
// `require("@napi-rs/canvas")` calls resolve from the sibling `node_modules`.
"use strict";

const { createRequire } = require("node:module");
const { existsSync } = require("node:fs");
const { basename, join } = require("node:path");

const hasEngine = (dir) => dir && existsSync(join(dir, "engine.cjs"));

// The launcher extracts `engine-<hash>.exe` and `engine-deps-<hash>/` as
// siblings named from the same content hash. In SEA, __filename is that exe
// path, so the exact deps dir for THIS build can be derived rather than guessed
// — important because upgrades leave older engine-deps-<hash> dirs in the cache.
function matchingDepsDir() {
  const match = /^engine-([0-9a-f]{16})\.exe$/i.exec(basename(__filename));
  if (!match) return null;
  return join(__dirname, `engine-deps-${match[1]}`);
}

function resolveDepsDir() {
  const candidates = [
    // Authoritative in the release path: the Rust launcher spawns the engine
    // with the extracted deps dir as cwd.
    process.cwd(),
    matchingDepsDir(),
    process.env.POGOPDF_ENGINE_DEPS,
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
