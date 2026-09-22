import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { typedError, unsupported } from "../tools/errors";

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
  /**
   * PyMuPDF base-14 font name of the span. PyMuPDF's `insert_text` accepts only
   * these names: `helv`, `heit`, `hebo`, `hebi` (Helvetica), `cour`, `cobo`,
   * `coit`, `cobi` (Courier), `tiro`, `tibo`, `tiit`, `tibi` (Times), `symb`
   * (Symbol), `zadb` (ZapfDingbats). Any other name raises
   * `ValueError: bad fontname`, so the span font is mapped through
   * {@link BASE14_FONT_PY} rather than passed through raw.
   */
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
 * Python helper shared by the extraction and edit scripts. PyMuPDF's
 * `insert_text` accepts only the 14 base-14 names: `helv`, `heit`, `hebo`,
 * `hebi` (Helvetica), `cour`, `cobo`, `coit`, `cobi` (Courier), `tiro`, `tibo`,
 * `tiit`, `tibi` (Times), `symb` (Symbol), `zadb` (ZapfDingbats). Any other name
 * (for example a raw embedded subset or "arial") raises `ValueError: bad
 * fontname`. This maps a raw span name onto the closest valid base-14 name,
 * falling back to `helv`, and is interpolated into both scripts so the
 * extraction and edit paths cannot disagree.
 */
const BASE14_FONT_PY = `
_BASE14 = {"helv", "heit", "hebo", "hebi", "cour", "cobo", "coit", "cobi",
           "tiro", "tibo", "tiit", "tibi", "symb", "zadb"}

def BASE14_FONT_PY(raw):
    name = raw.split("+")[-1].lower().replace(" ", "").replace("-", "")
    for base in ("helvetica", "courier", "times"):
        if name.find(base) >= 0:
            bold = "bold" in name or "black" in name
            italic = "italic" in name or "oblique" in name
            if base == "helvetica":
                return "hebi" if bold and italic else "hebo" if bold else "heit" if italic else "helv"
            if base == "courier":
                return "cobi" if bold and italic else "cobo" if bold else "coit" if italic else "cour"
            return "tibi" if bold and italic else "tibo" if bold else "tiit" if italic else "tiro"
    return name if name in _BASE14 else "helv"
`;

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

/**
 * The shared Pyodide instance, booting it on first use. Pyodide is a single
 * interpreter, so {@link withDoc} relies on the engine's serial job queue for
 * interpreter safety; Task 2 must keep editText on that queue rather than
 * calling it concurrently, or two operations could interleave on one global.
 */
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
${BASE14_FONT_PY}
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
    out.append({"text": text, "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                "originX": ox, "originY": oy, "size": s["size"],
                "font": BASE14_FONT_PY(s["font"])})
json.dumps(out)
`);
    return JSON.parse(result as string) as PyWord[];
  });
}

/** Callbacks the tool threads into the Python edit loop. */
export type EditRunOptions = {
  /** Called after each edit is inserted with (done, total). */
  onEdit?: (done: number, total: number) => void;
  /** Polled between edits; a true return aborts with a typed CANCELLED. */
  shouldCancel?: () => boolean;
};

/** Marker PyMuPDF raises as a RuntimeError so the TS layer can map it. */
const CANCEL_MARKER = "__POGO_CANCELLED__";
const UNSUPPORTED_MARKER = "__POGO_UNSUPPORTED__";

/**
 * Redact each edit's quad and insert its replacement text at the quad's baseline
 * start. All redactions for a page are applied before any insertion so the
 * inserted glyphs are not themselves erased. The font size starts at the
 * original span size and shrinks until the text fits the original quad width.
 *
 * Fonts: the span-derived base-14 name is used when it can render every
 * character. Base-14 fonts silently substitute placeholder dots for anything
 * outside their encoding, and PyMuPDF's bundled CJK font is the only other font
 * shipped (no font files are staged), so text the base font cannot render falls
 * back to that bundled font, embedded and subset per document. Text neither font
 * covers raises a typed UNSUPPORTED_FORMAT error instead of corrupting output.
 *
 * Returns the edited PDF bytes; the caller owns saving them.
 */
export async function editTextBytes(
  pdfBytes: Uint8Array,
  edits: TextEdit[],
  options: EditRunOptions = {}
): Promise<Uint8Array> {
  if (edits.length === 0) return pdfBytes;

  return withDoc(pdfBytes, async (docVar) => {
    const pyodide = await ensurePymupdf();
    // Replacement text is arbitrary, so it crosses as JSON in a global rather
    // than interpolated into the source; only the generated doc handle is.
    pyodide.globals.set("POGO_EDITS", JSON.stringify(edits));
    const onEdit = options.onEdit;
    const shouldCancel = options.shouldCancel;
    pyodide.globals.set("pogo_on_edit", (done: number, total: number) => {
      onEdit?.(done, total);
    });
    pyodide.globals.set("pogo_should_cancel", () => shouldCancel?.() ?? false);
    try {
      const result = await pyodide.runPythonAsync(`
import json, base64, pymupdf

doc = ${docVar}
edits = json.loads(POGO_EDITS)
${BASE14_FONT_PY}

# The bundled Droid Sans Fallback font is the only wide-coverage font shipped;
# it is written into the wasm FS lazily and embedded under a non-reserved name.
_CJK_NAME = "PogoCJK"
_CJK_PATH = "/pogo_cjk.ttf"
_cjk_ready = [False]
_support_cache = {}
_total = len(edits)
_done = 0

def _ensure_cjk_font():
    if not _cjk_ready[0]:
        open(_CJK_PATH, "wb").write(pymupdf.Font("china-s").buffer)
        _cjk_ready[0] = True

def _supports(fontname, fontfile, text):
    for ch in dict.fromkeys(text):
        if ch.isspace():
            continue
        key = (fontname, fontfile, ch)
        ok = _support_cache.get(key)
        if ok is None:
            d = pymupdf.open()
            p = d.new_page(width=200, height=200)
            try:
                if fontfile:
                    p.insert_text((20, 100), ch, fontsize=20, fontname="F0", fontfile=fontfile)
                else:
                    p.insert_text((20, 100), ch, fontsize=20, fontname=fontname)
                # A font without the glyph still inserts a placeholder, so the
                # round-trip read is the only honest encodability test.
                ok = p.get_text().strip() == ch
            except Exception:
                ok = False
            d.close()
            _support_cache[key] = ok
        if not ok:
            return False
    return True

def _choose_font(base_font, text):
    if _supports(base_font, None, text):
        return (base_font, None)
    _ensure_cjk_font()
    if _supports("F0", _CJK_PATH, text):
        return (_CJK_NAME, _CJK_PATH)
    bad = "".join(sorted({c for c in text
                          if not c.isspace()
                          and not _supports(base_font, None, c)
                          and not _supports("F0", _CJK_PATH, c)}))
    raise RuntimeError("${UNSUPPORTED_MARKER}" + bad)

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
    # Phase 1: capture each edit's span (font, size, baseline) BEFORE redacting.
    # Once apply_redactions() runs the span is gone, so _span_for() in phase 2
    # would always miss and silently fall back to 11pt at the quad bottom.
    prepared = []
    for e in page_edits:
        q = e["quad"]
        # Resolve the font here too: inserting into the scratch doc must not run
        # after the real page is redacted (it would not, but keeping font choice
        # in phase 1 makes unsupported text fail before any output is degraded).
        span = _span_for(page, q["x0"], q["y0"], q["x1"], q["y1"])
        if span is not None:
            base_size = span["size"]
            base_font = e.get("fontname") or BASE14_FONT_PY(span["font"])
            ox = span["origin"][0] + (q["x0"] - span["bbox"][0])
            oy = span["origin"][1]
        else:
            base_size = 11.0
            base_font = e.get("fontname") or "helv"
            ox, oy = q["x0"], q["y1"]
        fontname, fontfile = _choose_font(base_font, e["newText"])
        prepared.append((e, base_size, fontname, fontfile, ox, oy))

    # White fill is a known limitation: an edited region over a coloured page
    # background shows a white box. A background estimate would need a pixel
    # sample, which is out of scope for the prototype.
    for e, _, _, _, _, _ in prepared:
        q = e["quad"]
        rect = pymupdf.Rect(q["x0"], q["y0"], q["x1"], q["y1"])
        page.add_redact_annot(rect, fill=(1, 1, 1))
    page.apply_redactions()
    # Phase 2: insert replacements using the captured span values.
    for e, base_size, fontname, fontfile, ox, oy in prepared:
        q = e["quad"]
        new_text = e["newText"]
        target_w = max(q["x1"] - q["x0"], 0.1)
        measure = pymupdf.Font(fontfile=fontfile) if fontfile else pymupdf.Font(fontname)
        size = base_size
        while size > 1 and measure.text_length(new_text, fontsize=size) > target_w:
            size -= 0.5
        if fontfile:
            page.insert_text((ox, oy), new_text, fontsize=size, fontname=fontname,
                             fontfile=fontfile, color=(0, 0, 0))
        else:
            page.insert_text((ox, oy), new_text, fontsize=size, fontname=fontname,
                             color=(0, 0, 0))
        _done += 1
        pogo_on_edit(_done, _total)
        if pogo_should_cancel():
            raise RuntimeError("${CANCEL_MARKER}")

# Subset the embedded fallback font so a CJK edit adds a few KB, not the full
# multi-megabyte font. Base-14-only documents never embed anything.
if _cjk_ready[0]:
    try:
        doc.subset_fonts()
    except Exception:
        pass

out = doc.tobytes(garbage=1, deflate=True, clean=True)
base64.b64encode(out).decode("ascii")
`);
      return Uint8Array.from(Buffer.from(result as string, "base64"));
    } catch (e) {
      throw mapEditError(e);
    }
  });
}

/**
 * Map a PyMuPDF/Pyodide failure onto the engine's typed errors. The Python
 * loop raises the cancel and unsupported markers; encrypted documents surface
 * when PyMuPDF reads an encrypted page ("document closed or encrypted").
 */
function mapEditError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes(CANCEL_MARKER)) {
    return typedError("Job cancelled", TOOL_ERROR_CODES.CANCELLED);
  }
  if (msg.includes(UNSUPPORTED_MARKER)) {
    const chars = msg.slice(msg.indexOf(UNSUPPORTED_MARKER) + UNSUPPORTED_MARKER.length).trim();
    return unsupported(
      chars
        ? `The bundled fonts cannot render these characters: ${chars}`
        : "The bundled fonts cannot render the replacement text"
    );
  }
  if (/encrypt/i.test(msg)) {
    return typedError("Encrypted PDFs are not supported by editText", TOOL_ERROR_CODES.ENCRYPTED_PDF);
  }
  return e instanceof Error ? e : new Error(msg);
}

/**
 * Read `path`, edit the requested quads, and write the result to `outPath`.
 * Thin path wrapper over {@link editTextBytes} so tool handlers stay byte-free.
 */
export async function editTextFile(
  path: string,
  edits: TextEdit[],
  outPath: string,
  options: EditRunOptions = {}
): Promise<string> {
  const bytes = readFileSync(path);
  const out = await editTextBytes(new Uint8Array(bytes), edits, options);
  writeFileSync(outPath, out);
  return outPath;
}
