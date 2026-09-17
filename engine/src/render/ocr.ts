import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import Tesseract from "tesseract.js";

/**
 * One recognized text line: the text plus tesseract's bounding boxes in IMAGE
 * pixels (y grows downward). The searchable-PDF layer scales these to page
 * points to place an invisible text run near its visual position.
 */
export type OcrLine = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  baseline: { x0: number; y0: number; x1: number; y1: number };
};

export type OcrPageResult = {
  /** The page's plain text, as recognized. */
  text: string;
  /** Line-level geometry; empty when the recognition produced no blocks. */
  lines: OcrLine[];
};

/**
 * Directory of this module. esbuild's CJS output rewrites `import.meta.url` to
 * `__filename` (a plain Windows path), which `fileURLToPath` rejects, so accept
 * both shapes rather than assuming an ESM URL (same pattern as qpdfbin.ts).
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
 * Candidate locations for the vendored tesseract data directory, most specific
 * first:
 *
 * 1. `POGOPDF_OCR_DATA` - explicit override (CI, custom installs).
 * 2. Dev checkout: `<engine package>/ocr-data`, resolved from this module's
 *    directory (`engine/src/render` -> `../../ocr-data`).
 * 3. The bundled engine (`engine/dist/engine.cjs` -> `../ocr-data`), so a local
 *    run of the bundle still finds the staged data.
 * 4. Release: the Rust launcher spawns the engine with the extracted deps dir
 *    as cwd, and the release staging puts the data at `ocr-data/` inside it.
 * 5. Fallback for a manual launch with an unrelated cwd: walk up from the
 *    engine executable, looking inside sibling `engine-deps-<hash>` dirs.
 *
 * A user-provided langPath would let tesseract reach its default jsdelivr CDN,
 * so a missing directory must fail typed rather than silently going online.
 */
function dataDirCandidates(): string[] {
  const out: string[] = [];

  const override = process.env.POGOPDF_OCR_DATA;
  if (override) out.push(override);

  out.push(join(moduleDir(), "..", "..", "ocr-data"));
  out.push(join(moduleDir(), "..", "ocr-data"));
  out.push(join(process.cwd(), "ocr-data"));

  let dir = dirname(process.execPath);
  for (let depth = 0; depth < 4; depth++) {
    out.push(join(dir, "ocr-data"));
    for (const entry of safeReadDir(dir, "engine-deps-")) {
      out.push(join(dir, entry, "ocr-data"));
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

/**
 * First data directory that holds `<language>.traineddata`, or null. Exported
 * so a test can assert all 8 enum languages are staged.
 */
export function findOcrDataDir(language: string): string | null {
  for (const candidate of dataDirCandidates()) {
    if (existsSync(join(candidate, `${language}.traineddata`))) return candidate;
  }
  return null;
}

/** Resolved data dir, or a typed UNSUPPORTED_FORMAT telling the user how to get it. */
export function resolveOcrDataDir(language: string): string {
  const found = findOcrDataDir(language);
  if (!found) {
    throw Object.assign(
      new Error(
        `OCR language data for "${language}" not found. Run engine/scripts/fetch-ocr-data.ps1`
      ),
      { code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT }
    );
  }
  return found;
}

/**
 * Create one tesseract worker for a whole job. Workers are expensive (they load
 * a wasm core and the language model), so callers create one per run and
 * `terminate()` it in a finally block rather than per page.
 *
 * Offline guarantee: `langPath` points at our vendored directory and
 * `gzip: false` matches the uncompressed `.traineddata` files from
 * tesseract-ocr/tessdata_fast. `cacheMethod: "none"` stops tesseract from
 * reading or writing its default `.traineddata` disk cache, so the worker never
 * touches the network (the default CDN is only used when langPath is absent)
 * and never writes into the process cwd.
 */
export async function createOcrWorker(language: string, dpi?: number): Promise<Tesseract.Worker> {
  const langPath = resolveOcrDataDir(language);
  const worker = await Tesseract.createWorker(language, Tesseract.OEM.LSTM_ONLY, {
    langPath,
    gzip: false,
    cacheMethod: "none",
  });
  // The rendered PNG carries no resolution metadata, so tesseract would warn
  // "Invalid resolution 25 dpi" and assume 70; passing the real render dpi
  // keeps its layout heuristics correct.
  if (dpi !== undefined) {
    await worker.setParameters({ user_defined_dpi: String(dpi) });
  }
  return worker;
}

/**
 * Run recognition on a single page PNG. The worker's language is fixed at
 * creation, so it is not a parameter here. `blocks: true` is requested because
 * the searchable-PDF path needs line boxes; the text output is used by the
 * plain-text path.
 */
export async function runOcrPage(
  pngBuffer: Buffer,
  worker: Tesseract.Worker
): Promise<OcrPageResult> {
  const { data } = await worker.recognize(pngBuffer, {}, { text: true, blocks: true });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        if (!line.text.trim()) continue;
        lines.push({ text: line.text, bbox: line.bbox, baseline: line.baseline });
      }
    }
  }
  return { text: data.text, lines };
}
