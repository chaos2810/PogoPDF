import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { unsupported } from "../tools/errors";

/**
 * PyMuPDF compiled to WebAssembly (`@bentopdf/pymupdf-wasm`), used for in-place
 * text editing: redact a word quad, then insert replacement text at the same
 * baseline with the font size shrunk to fit the original width.
 *
 * The package is a Pyodide distribution (full CPython + a PyMuPDF wheel), not a
 * thin binding, so this module boots Pyodide directly and drives PyMuPDF through
 * `runPythonAsync`. The package's own `PyMuPDF` wrapper is bypassed on purpose:
 * its `open()` accepts only a Blob and its Node asset-path math mishandles
 * Windows drive-letter file URLs (it strips `file://` to `/C:/...`).
 *
 * Cold start measured on Windows x64, Node 24.18: ~0.8 s to boot Pyodide and
 * ~0.8 s to load the PyMuPDF wheel, ~1.6 s total. The interpreter is a process
 * singleton because every job shares one engine process.
 */

type PyodideLike = {
  runPythonAsync: (code: string) => Promise<unknown>;
  loadPackage: (path: string) => Promise<void>;
  globals: { set: (name: string, value: unknown) => void; get: (name: string) => unknown };
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  };
  version: string;
};

/** One extracted word with PyMuPDF page-space geometry (y grows downward). */
export type PyWord = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Baseline start of the word, where replacement text is inserted. */
  originX: number;
  originY: number;
  /** Font size of the span the word belongs to. */
  size: number;
  /** PyMuPDF base-14 font name of the span (e.g. "helv"). */
  font: string;
};

/** A quad is the word box the UI derived from a click, in page points. */
export type EditQuad = { x0: number; y0: number; x1: number; y1: number };

export type TextEdit = {
  /** 0-based page index. */
  page: number;
  /** Box to redact; the replacement is inserted at its baseline start. */
  quad: EditQuad;
  newText: string;
  /** Base-14 font name; defaults to the span-derived font of the first word. */
  fontname?: string;
};

/** PyMuPDF wheel for Python 3.13 as shipped in the package's assets directory. */
const PYMUPDF_WHEEL = "pymupdf-1.26.3-cp313-none-pyodide_2025_0_wasm32.whl";

/**
 * Directory of this module. esbuild's CJS output rewrites `import.meta.url` to
 * `__filename` (a plain Windows path), which `fileURLToPath` rejects, so accept
 * both shapes rather than assuming an ESM URL (same pattern as ocr.ts).
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
 * Candidate locations for the package's `assets/` directory (the Pyodide
 * runtime, `pyodide-lock.json`, and the wheels), most specific first:
 *
 * 1. `POGOPDF_PYMUPDF_ASSETS` - explicit override (CI, custom installs).
 * 2. Dev checkout: resolved from this module's directory
 *    (`engine/src/textedit` -> the workspace-root `node_modules`).
 * 3. The bundled engine (`engine/dist/engine.cjs` -> deps `node_modules`).
 * 4. Release: the Rust launcher spawns the engine with the extracted deps dir
 *    as cwd, and staging puts the package under `node_modules/`.
 * 5. Fallback for a manual launch with an unrelated cwd: walk up from the engine
 *    executable, looking inside sibling `engine-deps-<hash>` dirs.
 */
function assetDirCandidates(): string[] {
  const out: string[] = [];

  const override = process.env.POGOPDF_PYMUPDF_ASSETS;
  if (override) out.push(override);

  const rel = ["node_modules", "@bentopdf", "pymupdf-wasm", "assets"];
  out.push(join(moduleDir(), "..", "..", "..", ...rel));
  out.push(join(moduleDir(), "..", "..", ...rel));
  out.push(join(process.cwd(), ...rel));
  out.push(join(process.cwd(), "node_modules", "@bentopdf", "pymupdf-wasm", "assets"));

  let dir = dirname(process.execPath);
  for (let depth = 0; depth < 4; depth++) {
    out.push(join(dir, ...rel));
    for (const entry of safeReadDir(dir, "engine-deps-")) {
      out.push(join(dir, entry, ...rel));
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

/** True when a directory carries both the Pyodide runtime and the wheel. */
function isAssetDir(dir: string): boolean {
  return existsSync(join(dir, "pyodide.js")) && existsSync(join(dir, PYMUPDF_WHEEL));
}

/** First usable assets directory, or null when the package is not staged. */
export function findPymupdfAssets(): string | null {
  for (const candidate of assetDirCandidates()) {
    if (isAssetDir(candidate)) return candidate;
  }
  return null;
}

const MISSING_MESSAGE =
  "PyMuPDF wasm assets not found. Reinstall @bentopdf/pymupdf-wasm or run the release staging";

let pyodidePromise: Promise<PyodideLike> | undefined;

/**
 * Load the Pyodide entry point without exposing its path to any bundler. The
 * target is an absolute file inside the staged assets, not a resolvable package,
 * so Vite's module runner must not intercept it (it cannot resolve the URL) and
 * esbuild must not inline it. Node 24's `require(esm)` loads the ESM module
 * from a runtime string, and it also works inside the CJS engine bundle, which
 * a bare dynamic import does not.
 */
function loadModule(url: string): unknown {
  return createRequire(import.meta.url)(fileURLToPath(url));
}

/**
 * Boot Pyodide once per process and load the PyMuPDF wheel. The shims exist
 * because the package's `pyodide.js` detects Node and loads `pyodide.asm.js` as
 * an ES module inside a `"type": "module"` package, where Emscripten's generated
 * code expects CommonJS globals: `require` for `node:*` built-ins and
 * `__dirname` for locating its data files.
 *
 * Both shims stay installed for the whole boot because `loadPyodide` is where
 * `pyodide.asm.js` is actually evaluated, not the import of `pyodide.js`. They
 * are restored once the interpreter is up: any pre-existing value is put back,
 * and a global that did not exist before is deleted rather than left installed.
 */
async function bootPyodide(): Promise<PyodideLike> {
  const assets = findPymupdfAssets();
  if (!assets) throw unsupported(MISSING_MESSAGE);

  const previousRequire = (globalThis as { require?: unknown }).require;
  const previousDirname = (globalThis as { __dirname?: unknown }).__dirname;
  const hadRequire = "require" in globalThis;
  const hadDirname = "__dirname" in globalThis;

  try {
    (globalThis as { require?: unknown }).require = createRequire(import.meta.url);
    (globalThis as { __dirname?: unknown }).__dirname = assets;

    const url = pathToFileURL(join(assets, "pyodide.js")).href;
    const module = loadModule(url) as {
      loadPyodide: (opts: { indexURL: string }) => Promise<PyodideLike>;
    };

    // Pyodide parses the wheel argument as a URL/name; Windows backslashes read
    // as an escaping path and trigger an UnsupportedWheel traceback, so pass a
    // forward-slash path rooted at the same indexURL.
    const assetUrl = assets.replace(/\\/g, "/") + "/";
    const pyodide = await module.loadPyodide({ indexURL: assetUrl });
    await pyodide.loadPackage(assetUrl + PYMUPDF_WHEEL);
    await pyodide.runPythonAsync("import pymupdf");
    return pyodide;
  } finally {
    if (hadRequire) (globalThis as { require?: unknown }).require = previousRequire;
    else delete (globalThis as { require?: unknown }).require;
    if (hadDirname) (globalThis as { __dirname?: unknown }).__dirname = previousDirname;
    else delete (globalThis as { __dirname?: unknown }).__dirname;
  }
}

/** The shared Pyodide instance, booting it on first use. */
export function ensurePymupdf(): Promise<PyodideLike> {
  pyodidePromise ??= bootPyodide().catch((e) => {
    // A failed boot must not be cached, or every later job inherits the error.
    pyodidePromise = undefined;
    throw e;
  });
  return pyodidePromise;
}

/** Write bytes into the wasm FS under a unique path and run a body that closes it. */
async function withDoc<T>(
  pdfBytes: Uint8Array,
  body: (docVar: string) => Promise<T>
): Promise<T> {
  const pyodide = await ensurePymupdf();
  const docVar = `_pogo_doc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const inputPath = `/${docVar}.pdf`;
  pyodide.FS.writeFile(inputPath, pdfBytes);
  try {
    await pyodide.runPythonAsync(`${docVar} = pymupdf.open("${inputPath}")`);
    return await body(docVar);
  } finally {
    await pyodide
      .runPythonAsync(`${docVar}.close()`)
      .catch(() => undefined);
    try {
      pyodide.FS.unlink(inputPath);
    } catch {
      // Already gone; the wasm FS unlink is best-effort cleanup.
    }
  }
}

/** Extract the words of one page with their baseline origins and span fonts. */
export async function getPageWords(
  pdfBytes: Uint8Array,
  pageIndex: number
): Promise<PyWord[]> {
  return withDoc(pdfBytes, async (docVar) => {
    const pyodide = await ensurePymupdf();
    const result = await pyodide.runPythonAsync(`
import json
page = ${docVar}[${pageIndex}]
spans = [s for b in page.get_text("dict")["blocks"] if b.get("type") == 0
         for l in b["lines"] for s in l["spans"]]

def _span_for(x0, y0, x1, y1):
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    for s in spans:
        bx0, by0, bx1, by1 = s["bbox"]
        if bx0 <= cx <= bx1 and by0 <= cy <= by1:
            return s
    return None

out = []
for w in page.get_text("words"):
    x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4]
    s = _span_for(x0, y0, x1, y1)
    if s is None:
        continue
    origin = s["origin"]
    # A span's origin is its left baseline; offset by the word's distance from
    # the span's left edge so the origin lands on the word itself.
    ox = origin[0] + (x0 - s["bbox"][0])
    oy = origin[1]
    font = s["font"].split("+")[-1]
    base = {"helvetica": "helv", "courier": "cour", "times": "tiro"}.get(
        font.lower().replace(" ", ""), font.lower()
    )
    out.append({"text": text, "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                "originX": ox, "originY": oy, "size": s["size"], "font": base})
json.dumps(out)
`);
    return JSON.parse(result as string) as PyWord[];
  });
}

/**
 * Redact each edit's quad and insert its replacement text at the quad's baseline
 * start. All redactions for a page are applied before any insertion so the
 * inserted glyphs are not themselves erased. The font size starts at the
 * original span size and shrinks until the text fits the original quad width.
 *
 * Returns the edited PDF bytes; the caller owns saving them.
 */
export async function editTextBytes(
  pdfBytes: Uint8Array,
  edits: TextEdit[]
): Promise<Uint8Array> {
  if (edits.length === 0) return pdfBytes;

  return withDoc(pdfBytes, async (docVar) => {
    const pyodide = await ensurePymupdf();
    // Replacement text is arbitrary, so it crosses as JSON in a global rather
    // than interpolated into the source; only the generated doc handle is.
    pyodide.globals.set("POGO_EDITS", JSON.stringify(edits));
    const result = await pyodide.runPythonAsync(`
import json, base64, pymupdf

doc = ${docVar}
edits = json.loads(POGO_EDITS)

by_page = {}
for e in edits:
    by_page.setdefault(e["page"], []).append(e)

def _span_for(page, x0, y0, x1, y1):
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0:
            continue
        for l in b["lines"]:
            for s in l["spans"]:
                bx0, by0, bx1, by1 = s["bbox"]
                if bx0 <= cx <= bx1 and by0 <= cy <= by1:
                    return s
    return None

for page_index, page_edits in by_page.items():
    page = doc[page_index]
    # Phase 1: redact every edited quad on this page.
    for e in page_edits:
        q = e["quad"]
        rect = pymupdf.Rect(q["x0"], q["y0"], q["x1"], q["y1"])
        page.add_redact_annot(rect, fill=(1, 1, 1))
    page.apply_redactions()
    # Phase 2: insert replacements that survived the redaction pass.
    for e in page_edits:
        q = e["quad"]
        span = _span_for(page, q["x0"], q["y0"], q["x1"], q["y1"])
        base_size = span["size"] if span else 11.0
        fontname = e.get("fontname") or ("helv" if span is None else
            {"helvetica": "helv", "courier": "cour", "times": "tiro"}.get(
                span["font"].split("+")[-1].lower().replace(" ", ""), "helv"))
        new_text = e["newText"]
        target_w = max(q["x1"] - q["x0"], 0.1)
        size = base_size
        while size > 1 and pymupdf.get_text_length(new_text, fontname=fontname, fontsize=size) > target_w:
            size -= 0.5
        if span is not None:
            ox = span["origin"][0] + (q["x0"] - span["bbox"][0])
            oy = span["origin"][1]
        else:
            ox, oy = q["x0"], q["y1"]
        page.insert_text((ox, oy), new_text, fontsize=size, fontname=fontname, color=(0, 0, 0))

out = doc.tobytes(garbage=1, deflate=True, clean=True)
base64.b64encode(out).decode("ascii")
`);
    return Uint8Array.from(Buffer.from(result as string, "base64"));
  });
}

/**
 * Read `path`, edit the requested quads, and write the result to `outPath`.
 * Thin path wrapper over {@link editTextBytes} so tool handlers stay byte-free.
 */
export async function editTextFile(
  path: string,
  edits: TextEdit[],
  outPath: string
): Promise<string> {
  const bytes = readFileSync(path);
  const out = await editTextBytes(new Uint8Array(bytes), edits);
  writeFileSync(outPath, out);
  return outPath;
}
