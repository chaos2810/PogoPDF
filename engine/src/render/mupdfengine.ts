import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import type * as Mupdf from "mupdf";
import { corrupt, unsupported } from "../tools/errors";

export type RichDocumentKind = "ebook" | "xps";

type MupdfModule = typeof import("mupdf");

/**
 * mupdf is ESM-only and evaluates a top-level `await` while loading its wasm
 * module, so it can never be inlined into the CommonJS engine bundle. It is
 * marked `--external:mupdf` and loaded once through a dynamic import, which
 * esbuild preserves for the runtime. In dev and in the release tree the package
 * (including dist/mupdf-wasm.wasm) resolves from node_modules next to the
 * engine.
 */
let modulePromise: Promise<MupdfModule> | undefined;

/**
 * Load (once) and return the mupdf module handle. Image-ops handlers render
 * PDF pages through mupdf's Pixmap API, so they share this cache with the
 * rich-content path rather than importing the wasm bundle a second time.
 */
export function loadMupdf(): Promise<MupdfModule> {
  modulePromise ??= import("mupdf");
  return modulePromise;
}

const EBOOK_MAGIC: Record<string, string> = {
  epub: "application/epub+zip",
  fb2: "application/x-fictionbook+xml",
};

const XPS_MAGIC: Record<string, string> = {
  xps: "application/oxps",
  oxps: "application/oxps",
};

/** The mupdf content-type hint for a path, or a typed UNSUPPORTED_FORMAT. */
function magicFor(path: string, kind: RichDocumentKind): string {
  const ext = extname(path).slice(1).toLowerCase();
  const table = kind === "xps" ? XPS_MAGIC : EBOOK_MAGIC;
  const magic = table[ext];
  if (!magic) {
    const expected = Object.keys(table).join(", ");
    throw unsupported(`Unsupported ${kind} format ".${ext}" (expected ${expected})`);
  }
  return magic;
}

/** A4 in points, the page size mupdf lays reflowable books onto. */
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;

/**
 * A loaded mupdf document plus the module that owns it. The wrapper exists so
 * callers never hold the module handle and the document separately; relay and
 * layout always operate on the same module instance.
 */
export class RichDocument {
  private constructor(
    private readonly mupdf: MupdfModule,
    private readonly doc: Mupdf.Document
  ) {}

  static async open(path: string, kind: RichDocumentKind): Promise<RichDocument> {
    const magic = magicFor(path, kind);
    if (!existsSync(path)) throw corrupt(`File not found: ${path}`);

    const bytes = readFileSync(path);
    const mupdf = await loadMupdf();
    let doc: Mupdf.Document;
    try {
      doc = mupdf.Document.openDocument(bytes, magic);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // The official MuPDF.js wasm build compiles the XPS module out
      // (platform/wasm build passes xps=no), so a valid XPS file fails here
      // with "cannot find document handler". That is a build capability gap,
      // not a corrupt file, and must not be reported as one.
      if (/cannot find document handler/i.test(msg)) {
        throw unsupported(
          `This build of the PDF engine does not include support for this format (${magic}). ${msg}`
        );
      }
      throw corrupt(`Cannot open ${path}: ${msg}`);
    }
    if (doc.needsPassword()) {
      throw Object.assign(new Error(`Encrypted documents are not supported: ${path}`), {
        code: TOOL_ERROR_CODES.ENCRYPTED_PDF,
      });
    }
    return new RichDocument(mupdf, doc);
  }

  get pageCount(): number {
    return this.doc.countPages();
  }

  /**
   * Relayout a reflowable document (EPUB/FB2). `fontSize` is the base em in
   * points; the user stylesheet sets the page margin. Both are applied before
   * pages are read, and layout can change the page count.
   */
  layout(options: { fontSize: number; margins: number }): void {
    this.doc.style(true, `@page { margin: ${options.margins}pt; }`);
    this.doc.layout(A4_WIDTH_PT, A4_HEIGHT_PT, options.fontSize);
  }

  /**
   * Run every laid-out page through mupdf's PDF DocumentWriter and return the
   * resulting bytes. Pages and devices are released per iteration so large
   * books do not accumulate wrappers; the bytes are copied out of the wasm heap
   * because the view is invalidated by later wasm allocations.
   */
  relayToPdf(onPage?: (done: number, total: number) => void): Uint8Array {
    const total = this.pageCount;
    const out = new this.mupdf.Buffer();
    const writer = new this.mupdf.DocumentWriter(out, "pdf", "");
    try {
      for (let i = 0; i < total; i++) {
        const page = this.doc.loadPage(i);
        try {
          const device = writer.beginPage(page.getBounds());
          try {
            page.run(device, this.mupdf.Matrix.identity);
          } finally {
            device.close();
          }
          writer.endPage();
        } finally {
          page.destroy();
        }
        onPage?.(i + 1, total);
      }
    } finally {
      writer.close();
    }
    return Uint8Array.from(out.asUint8Array());
  }

  close(): void {
    this.doc.destroy();
  }
}

