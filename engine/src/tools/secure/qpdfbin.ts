import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";

/** Typed error with an RPC error code. */
export function qpdfError(message: string, code: number): Error {
  return Object.assign(new Error(message), { code });
}

const NOT_FOUND_MESSAGE =
  "qpdf not found — run engine/scripts/fetch-qpdf.ps1";

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

/**
 * Candidate locations for qpdf.exe, most specific first:
 *
 * 1. `POGOPDF_QPDF_BIN` — explicit override (CI, custom installs).
 * 2. Dev checkout: `<engine package>/qpdf-bin/qpdf.exe`, resolved from this
 *    module's own directory. In the release bundle this points at the deps dir
 *    and simply misses, which is why candidate 3 exists.
 * 3. Release: the Rust launcher spawns the engine with the extracted deps dir as
 *    cwd, and the release staging puts qpdf at `qpdf/qpdf.exe` inside it.
 * 4. Fallback for a manual launch with an unrelated cwd: walk up from the engine
 *    executable, and look inside any sibling deps directory named
 *    `engine-deps-<hash>` (that is where the launcher unpacks the archive next
 *    to the exe).
 */
function qpdfCandidates(): string[] {
  const out: string[] = [];

  const override = process.env.POGOPDF_QPDF_BIN;
  if (override) out.push(override);

  out.push(join(moduleDir(), "..", "..", "..", "qpdf-bin", "qpdf.exe"));

  out.push(join(process.cwd(), "qpdf", "qpdf.exe"));

  let dir = dirname(process.execPath);
  for (let depth = 0; depth < 4; depth++) {
    out.push(join(dir, "qpdf", "qpdf.exe"));
    for (const entry of safeReadDir(dir, "engine-deps-")) {
      out.push(join(dir, entry, "qpdf", "qpdf.exe"));
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return out;
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

/** First existing qpdf.exe, or null when none is present. */
export function findQpdf(): string | null {
  for (const candidate of qpdfCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolved qpdf path, or a typed UNSUPPORTED_FORMAT telling the user how to get it. */
export function resolveQpdf(): string {
  const found = findQpdf();
  if (!found) {
    throw qpdfError(NOT_FOUND_MESSAGE, TOOL_ERROR_CODES.UNSUPPORTED_FORMAT);
  }
  return found;
}

/** Input paths are user paths, so a missing file is worth naming cleanly. */
export function assertInputExists(filePath: string): void {
  if (!existsSync(filePath)) {
    throw qpdfError(`File not found: ${filePath}`, TOOL_ERROR_CODES.CORRUPT_PDF);
  }
}

export type QpdfResult = { stdout: string; stderr: string };

const STDERR_TAIL = 200;
// qpdf reports a wrong/missing password as "invalid password" (stderr) or
// "Incorrect password supplied" (stdout, from --show-encryption) and exits 2,
// not 3 — exit 3 means "warnings only" per `qpdf --help=exit-status`.
const PASSWORD_PATTERN = /password/i;

function spawnQpdf(
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
 * Run qpdf with `args` and wait for exit. `outDir` is the spawn cwd: qpdf
 * receives absolute paths, so the engine's own cwd can never affect the result.
 * Exit 0 is success (warnings included); a password report becomes ENCRYPTED_PDF
 * and anything else CORRUPT_PDF with the stderr tail in the message.
 */
export async function runQpdf(args: string[], outDir: string): Promise<QpdfResult> {
  const bin = resolveQpdf();
  let code: number | null;
  let stdout: string;
  let stderr: string;
  try {
    ({ code, stdout, stderr } = await spawnQpdf(bin, args, outDir));
  } catch (e) {
    throw qpdfError(
      `${NOT_FOUND_MESSAGE} (${e instanceof Error ? e.message : String(e)})`,
      TOOL_ERROR_CODES.UNSUPPORTED_FORMAT
    );
  }

  if (code === 0) return { stdout, stderr };

  if (PASSWORD_PATTERN.test(stdout) || PASSWORD_PATTERN.test(stderr)) {
    throw qpdfError(
      "This PDF is encrypted and the supplied password was rejected",
      TOOL_ERROR_CODES.ENCRYPTED_PDF
    );
  }

  const tail = stderr.trim().slice(-STDERR_TAIL);
  throw qpdfError(
    `qpdf failed (exit ${code})${tail ? `: ${tail}` : ""}`,
    TOOL_ERROR_CODES.CORRUPT_PDF
  );
}
