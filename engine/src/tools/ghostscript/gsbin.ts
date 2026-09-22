import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";

/** Typed error with an RPC error code. */
export function gsError(message: string, code: number): Error {
  return Object.assign(new Error(message), { code });
}

const NOT_FOUND_MESSAGE =
  "Ghostscript not found. Run engine/scripts/fetch-ghostscript.ps1";
const SPAWN_FAILED_MESSAGE = "Ghostscript failed to start";
const STDERR_TAIL = 400;

/**
 * Directory of this module. esbuild's CJS output rewrites `import.meta.url` to
 * `__filename` (a plain Windows path), which `fileURLToPath` rejects, so accept
 * both shapes rather than assuming an ESM URL.
 */
function moduleDir(): string {
  const url = import.meta.url;
  try {
    return dirname(fileURLToPath(url));
  } catch {
    return dirname(url);
  }
}

function safeReadDir(dir: string, prefix: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith(prefix))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Candidate locations for gswin64c.exe, most specific first:
 *
 * 1. `POGOPDF_GS_BIN` explicit override (CI, custom installs). Accepts either
 *    the exe itself or a directory (then `<dir>/bin/gswin64c.exe`).
 * 2. Dev checkout: `<engine package>/gs-bin/bin/gswin64c.exe`, resolved from
 *    this module's own directory.
 * 3. Release: the Rust launcher spawns the engine with the extracted deps dir as
 *    cwd, and the release staging puts the Ghostscript tree at `gs/` inside it.
 * 4. Fallback for a manual launch with an unrelated cwd: walk up from the engine
 *    executable and look inside any sibling deps directory named
 *    `engine-deps-<hash>`.
 */
function gswinCandidates(): string[] {
  const out: string[] = [];

  const override = process.env.POGOPDF_GS_BIN;
  if (override) {
    out.push(
      override.toLowerCase().endsWith("gswin64c.exe")
        ? override
        : join(override, "bin", "gswin64c.exe")
    );
  }

  out.push(join(moduleDir(), "..", "..", "..", "gs-bin", "bin", "gswin64c.exe"));

  out.push(join(process.cwd(), "gs", "bin", "gswin64c.exe"));

  let dir = dirname(process.execPath);
  for (let depth = 0; depth < 4; depth++) {
    out.push(join(dir, "gs", "bin", "gswin64c.exe"));
    for (const entry of safeReadDir(dir, "engine-deps-")) {
      out.push(join(dir, entry, "gs", "bin", "gswin64c.exe"));
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return out;
}

/** First existing gswin64c.exe, or null when none is present. */
export function findGswin(): string | null {
  for (const candidate of gswinCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolved gswin64c path, or a typed UNSUPPORTED_FORMAT telling the user how to get it. */
export function resolveGswin(): string {
  const found = findGswin();
  if (!found) {
    throw gsError(NOT_FOUND_MESSAGE, TOOL_ERROR_CODES.UNSUPPORTED_FORMAT);
  }
  return found;
}

export type GsResult = { stdout: string; stderr: string };

function spawnGs(
  bin: string,
  args: string[],
  cwd: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Run gswin64c with `args` and wait for exit. `outDir` is the spawn cwd;
 * callers pass absolute paths, so the engine's own cwd never affects the result.
 *
 * Exit 0 is success and `--version` is a safe, fast probe (unlike soffice, gs
 * does not start a server or unpack a profile). Ghostscript reports some input
 * problems as a non-zero exit and others as a warning on stdout with a
 * still-produced (blank) file; the caller inspects the output, and only a
 * non-zero exit is mapped here, to CORRUPT_PDF with the stderr tail.
 */
export async function runGs(args: string[], outDir: string): Promise<GsResult> {
  const bin = resolveGswin();
  let code: number | null;
  let stdout: string;
  let stderr: string;
  try {
    ({ code, stdout, stderr } = await spawnGs(bin, args, outDir));
  } catch (e) {
    // The exe exists (resolveGswin passed) but could not launch, so advice to
    // fetch it would be wrong.
    throw gsError(
      `${SPAWN_FAILED_MESSAGE} (${e instanceof Error ? e.message : String(e)})`,
      TOOL_ERROR_CODES.UNSUPPORTED_FORMAT
    );
  }

  if (code === 0) return { stdout, stderr };

  const tail = (stderr || stdout).trim().slice(-STDERR_TAIL);
  throw gsError(
    `Ghostscript failed (exit ${code})${tail ? `: ${tail}` : ""}`,
    TOOL_ERROR_CODES.CORRUPT_PDF
  );
}
