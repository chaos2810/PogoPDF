import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";

/** Typed error with an RPC error code. */
export function officeError(message: string, code: number): Error {
  return Object.assign(new Error(message), { code });
}

const NOT_FOUND_MESSAGE =
  "LibreOffice not found. Run engine/scripts/fetch-libreoffice.ps1";
const SPAWN_FAILED_MESSAGE = "LibreOffice failed to start";
const STDERR_TAIL = 300;

/**
 * Which export filter LibreOffice uses for a given input extension. The
 * extension drives the filter because OfficeToPdfInputSchema carries no format
 * hint; each document family has its own PDF export filter.
 */
export const EXPORT_FILTERS: Record<string, string> = {
  docx: "writer_pdf_Export",
  doc: "writer_pdf_Export",
  rtf: "writer_pdf_Export",
  odt: "writer_pdf_Export",
  xlsx: "calc_pdf_Export",
  xls: "calc_pdf_Export",
  ods: "calc_pdf_Export",
  pptx: "impress_pdf_Export",
  ppt: "impress_pdf_Export",
  odp: "impress_pdf_Export",
  odg: "draw_pdf_Export",
};

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
 * Candidate locations for soffice.exe, most specific first:
 *
 * 1. `POGOPDF_LO_BIN` explicit override (CI, custom installs). Accepts either
 *    the exe itself or a directory (then `<dir>/program/soffice.exe`).
 * 2. Dev checkout: `<engine package>/lo-bin/program/soffice.exe`, resolved from
 *    this module's own directory.
 * 3. Release: the Rust launcher spawns the engine with the extracted deps dir as
 *    cwd, and the release staging puts the LibreOffice tree at `lo/` inside it.
 * 4. Fallback for a manual launch with an unrelated cwd: walk up from the engine
 *    executable and look inside any sibling deps directory named
 *    `engine-deps-<hash>`.
 */
function sofficeCandidates(): string[] {
  const out: string[] = [];

  const override = process.env.POGOPDF_LO_BIN;
  if (override) {
    out.push(override.toLowerCase().endsWith("soffice.exe") ? override : join(override, "program", "soffice.exe"));
  }

  out.push(join(moduleDir(), "..", "..", "..", "lo-bin", "program", "soffice.exe"));

  out.push(join(process.cwd(), "lo", "program", "soffice.exe"));

  let dir = dirname(process.execPath);
  for (let depth = 0; depth < 4; depth++) {
    out.push(join(dir, "lo", "program", "soffice.exe"));
    for (const entry of safeReadDir(dir, "engine-deps-")) {
      out.push(join(dir, entry, "lo", "program", "soffice.exe"));
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return out;
}

/** First existing soffice.exe, or null when none is present. */
export function findSoffice(): string | null {
  for (const candidate of sofficeCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolved soffice path, or a typed UNSUPPORTED_FORMAT telling the user how to get it. */
export function resolveSoffice(): string {
  const found = findSoffice();
  if (!found) {
    throw officeError(NOT_FOUND_MESSAGE, TOOL_ERROR_CODES.UNSUPPORTED_FORMAT);
  }
  return found;
}

function spawnSoffice(
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
 * `soffice.exe` is a launcher that starts `soffice.bin` and may, on some builds,
 * return before the conversion finishes. Modern headless `--convert-to` blocks
 * until the file is written (verified empirically; see the task report), but the
 * wrapper still polls briefly for the output so an early-returning launcher
 * cannot turn a successful conversion into a spurious error.
 */
async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return existsSync(path);
}

const OUTPUT_POLL_MS = 30_000;

/**
 * Convert one office/ODF document to PDF with headless LibreOffice. The output
 * is LibreOffice's default name, `<basename>.pdf`, inside `outDir`; its path is
 * returned. `jobId` scopes the per-job profile dir so two concurrent runs never
 * share a profile lock.
 */
export async function runOfficeConvert(
  inputPath: string,
  outDir: string,
  jobId: string
): Promise<string> {
  const ext = extname(inputPath).slice(1).toLowerCase();
  const filter = EXPORT_FILTERS[ext];
  if (!filter) {
    throw officeError(
      `Unsupported office format: .${ext || "(none)"}`,
      TOOL_ERROR_CODES.UNSUPPORTED_FORMAT
    );
  }

  const bin = resolveSoffice();

  const profileDir = join(outDir, `lo-profile-${jobId}`);
  const profileUrl = pathToFileURL(profileDir).href;
  const outPath = join(outDir, `${basename(inputPath, extname(inputPath))}.pdf`);

  const args = [
    "--headless",
    "--norestore",
    "--nolockcheck",
    "--nodefault",
    `--convert-to`,
    `pdf:${filter}`,
    "--outdir",
    outDir,
    `-env:UserInstallation=${profileUrl}`,
    inputPath,
  ];

  let code: number | null;
  let stdout: string;
  let stderr: string;
  try {
    ({ code, stdout, stderr } = await spawnSoffice(bin, args, outDir));
  } catch (e) {
    // The binary resolved but the process could not start: a corrupt install or
    // a bad path, not an unsupported format. The missing-binary case is handled
    // earlier by resolveSoffice, which stays UNSUPPORTED_FORMAT.
    throw officeError(
      `${SPAWN_FAILED_MESSAGE} (${e instanceof Error ? e.message : String(e)})`,
      TOOL_ERROR_CODES.CORRUPT_PDF
    );
  }

  // Modern headless `--convert-to` blocks until the export is written (verified
  // empirically for LibreOffice 26.2; see the task report), so the file normally
  // exists the moment the process closes. Poll anyway so an early-returning
  // launcher cannot turn a successful conversion into a spurious error, and
  // accept the file even when the launcher reports a non-zero code.
  if (!existsSync(outPath)) {
    await waitForFile(outPath, OUTPUT_POLL_MS);
  }

  if (existsSync(outPath)) return outPath;

  const tail = stderr.trim().slice(-STDERR_TAIL);
  throw officeError(
    `LibreOffice conversion failed (exit ${code})${tail ? `: ${tail}` : ""}`,
    TOOL_ERROR_CODES.CORRUPT_PDF
  );
}
