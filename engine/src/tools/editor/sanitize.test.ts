import { describe, it, expect, beforeAll } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureDir } from "../../testing/fixtures";
import { registerTools } from "../registry";
import { runViewMetadata } from "../../tools/convertout/viewmetadata";
import { writeAnnotations } from "./annotations";
import { runSanitize } from "./sanitize";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

const ATTACH_MARKER = "SANITIZE_ATTACH_MARKER_ABC123";
const XMP_MARKER = "SANITIZE_XMP_MARKER_XYZ789";

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-sanitize-"));
}

function resolve(doc: PDFDocument, obj: unknown): unknown {
  return obj && typeof obj === "object" && "objectNumber" in (obj as object)
    ? doc.context.lookup(obj as never)
    : obj;
}

function namesDict(doc: PDFDocument): PDFDict | undefined {
  return doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
}

async function load(path: string): Promise<PDFDocument> {
  return PDFDocument.load(readFileSync(path));
}

function addJavaScript(doc: PDFDocument, name: string, code: string): void {
  const context = doc.context;
  if (!doc.catalog.has(PDFName.of("Names"))) {
    doc.catalog.set(PDFName.of("Names"), context.obj({}));
  }
  const names = doc.catalog.lookup(PDFName.of("Names"), PDFDict);
  if (!names.has(PDFName.of("JavaScript"))) {
    names.set(PDFName.of("JavaScript"), context.obj({}));
  }
  const jsDict = names.lookup(PDFName.of("JavaScript"), PDFDict);
  if (!jsDict.has(PDFName.of("Names"))) {
    jsDict.set(PDFName.of("Names"), context.obj([]));
  }
  const jsNames = jsDict.lookup(PDFName.of("Names"), PDFArray);
  const action = context.obj({
    S: "JavaScript",
    JS: PDFString.of(code),
  });
  jsNames.push(PDFString.of(name));
  jsNames.push(context.register(action));
}

async function hasEmbeddedFilesAsync(path: string): Promise<boolean> {
  const doc = await load(path);
  const root = namesDict(doc)?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  const names = root?.lookupMaybe(PDFName.of("Names"), PDFArray);
  return !!names && names.size() > 0;
}

async function hasJavaScriptAsync(path: string): Promise<boolean> {
  const doc = await load(path);
  const js = namesDict(doc)?.lookupMaybe(PDFName.of("JavaScript"), PDFDict);
  const names = js?.lookupMaybe(PDFName.of("Names"), PDFArray);
  return !!names && names.size() > 0;
}

async function pageHasAnnots(path: string, pageIndex: number): Promise<boolean> {
  const doc = await load(path);
  const raw: unknown = doc.getPage(pageIndex).node.get(PDFName.of("Annots"));
  const arr = resolve(doc, raw);
  return arr instanceof PDFArray && arr.size() > 0;
}

/**
 * Kitchen-sink PDF carrying metadata, an annotation, a form field, a JS action,
 * an embedded file and an XMP stream. Attachment and XMP bytes are written as
 * uncompressed streams with recognizable markers (useObjectStreams:false) so the
 * byte-level scrub can be asserted with a plain Buffer search.
 */
async function makeKitchenSink(path: string): Promise<string> {
  const doc = await PDFDocument.create();
  doc.setTitle("Sensitive title");
  doc.setAuthor("Sensitive author");
  doc.setSubject("Sensitive subject");
  const page = doc.addPage([300, 200]);
  const field = doc.getForm().createTextField("name");
  field.setText("Hello");
  field.addToPage(page, { x: 40, y: 120, width: 160, height: 20 });
  addJavaScript(doc, "init", "app.alert('hi');");
  await writeAnnotations(
    doc,
    [
      {
        type: "rect",
        page: 1,
        color: "#DC2626",
        opacity: 1,
        lineWidth: 2,
        fontSize: 14,
        rect: { x: 20, y: 20, w: 60, h: 40 },
      },
    ],
    { cancelled: () => false }
  );

  const context = doc.context;
  const attachBytes = new TextEncoder().encode(ATTACH_MARKER);
  const streamRef = context.register(
    context.stream(attachBytes, {
      Type: "EmbeddedFile",
      Params: { Size: attachBytes.length },
    })
  );
  const specRef = context.register(
    context.obj({ Type: "Filespec", F: PDFString.of("note.txt"), EF: { F: streamRef } })
  );
  // Merge into the existing /Names dict so the JavaScript subtree survives.
  const names = doc.catalog.lookup(PDFName.of("Names"), PDFDict);
  names.set(
    PDFName.of("EmbeddedFiles"),
    context.obj({ Names: [PDFString.of("note.txt"), specRef] })
  );
  doc.catalog.set(PDFName.of("AF"), context.obj([specRef]));

  const xmpBytes = new TextEncoder().encode(XMP_MARKER);
  const xmpRef = context.register(
    context.stream(xmpBytes, { Type: "Metadata", Subtype: "XML" })
  );
  doc.catalog.set(PDFName.of("Metadata"), xmpRef);

  writeFileSync(path, await doc.save({ useObjectStreams: false }));
  return path;
}

function rawBytes(path: string): Buffer {
  return readFileSync(path);
}

function containsMarker(path: string, marker: string): boolean {
  return rawBytes(path).includes(Buffer.from(marker, "latin1"));
}

describe("runSanitize", () => {
  let dir: string;
  let sink: string;

  beforeAll(async () => {
    dir = fixtureDir("editor-sanitize");
    sink = await makeKitchenSink(join(dir, "base.pdf"));
  });

  it("removes all five surfaces when every flag is on", async () => {
    const out = await runSanitize({ filePath: sink }, ctx, outDir());
    expect(out.endsWith("sanitized.pdf")).toBe(true);

    const data = await runViewMetadata({ filePath: out }, ctx, outDir());
    expect(data.title).toBeNull();
    expect(data.author).toBeNull();
    expect(data.subject).toBeNull();
    expect(data.creationDate).toBeNull();

    expect(await pageHasAnnots(out, 0)).toBe(false);
    expect(await hasEmbeddedFilesAsync(out)).toBe(false);
    expect(await hasJavaScriptAsync(out)).toBe(false);

    const doc = await load(out);
    expect(doc.getForm().getFields()).toHaveLength(0);
  });

  it("scrubs attachment and XMP marker bytes from the output", async () => {
    // Precondition: the markers really are in the input's raw bytes.
    expect(containsMarker(sink, ATTACH_MARKER)).toBe(true);
    expect(containsMarker(sink, XMP_MARKER)).toBe(true);

    const out = await runSanitize({ filePath: sink }, ctx, outDir());
    expect(containsMarker(out, ATTACH_MARKER)).toBe(false);
    expect(containsMarker(out, XMP_MARKER)).toBe(false);
  });

  it("keeps annotations when removeAnnotations is false", async () => {
    const out = await runSanitize(
      {
        filePath: sink,
        removeMetadata: false,
        removeAnnotations: false,
        removeAttachments: false,
        removeJavaScript: false,
        flattenForms: false,
      },
      ctx,
      outDir()
    );
    expect(await pageHasAnnots(out, 0)).toBe(true);
    const doc = await load(out);
    expect(doc.getForm().getFields()).toHaveLength(1);
    expect(await hasEmbeddedFilesAsync(out)).toBe(true);
    expect(await hasJavaScriptAsync(out)).toBe(true);
  });

  it("flattens forms only when flattenForms is the sole flag", async () => {
    const out = await runSanitize(
      {
        filePath: sink,
        removeMetadata: false,
        removeAnnotations: false,
        removeAttachments: false,
        removeJavaScript: false,
        flattenForms: true,
      },
      ctx,
      outDir()
    );
    const doc = await load(out);
    expect(doc.getForm().getFields()).toHaveLength(0);
  });

  it("keeps metadata when removeMetadata is false", async () => {
    const out = await runSanitize(
      {
        filePath: sink,
        removeMetadata: false,
        removeAnnotations: true,
        removeAttachments: true,
        removeJavaScript: true,
        flattenForms: false,
      },
      ctx,
      outDir()
    );
    const data = await runViewMetadata({ filePath: out }, ctx, outDir());
    expect(data.title).toBe("Sensitive title");
    expect(data.author).toBe("Sensitive author");
  });

  it("keeps attachments and their bytes when removeAttachments is false", async () => {
    // flattenForms off: the qpdf pass recompresses streams, hiding raw markers.
    const out = await runSanitize(
      { filePath: sink, removeAttachments: false, flattenForms: false },
      ctx,
      outDir()
    );
    expect(await hasEmbeddedFilesAsync(out)).toBe(true);
    expect(containsMarker(out, ATTACH_MARKER)).toBe(true);
  });

  it("keeps JavaScript when removeJavaScript is false", async () => {
    const out = await runSanitize(
      { filePath: sink, removeJavaScript: false, flattenForms: false },
      ctx,
      outDir()
    );
    expect(await hasJavaScriptAsync(out)).toBe(true);
  });

  it("maps a missing file to CORRUPT_PDF", async () => {
    await expect(
      runSanitize({ filePath: join(dir, "nope.pdf") }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("throws CANCELLED when cancelled before doing any work", async () => {
    await expect(
      runSanitize({ filePath: sink }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("editor sanitize registry", () => {
  it("registers sanitize", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("sanitize")).toBe(true);
  });
});
