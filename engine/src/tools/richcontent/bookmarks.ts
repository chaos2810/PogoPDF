import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFHexString,
  PDFString,
  PDFArray,
  PDFNumber,
  PDFRef,
} from "pdf-lib";
import {
  EditBookmarksInputSchema,
  TocInputSchema,
  TOOL_ERROR_CODES,
  ViewBookmarksInputSchema,
  type BookmarkNode,
} from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled, invalidInput } from "../organize/organize";
import { loadPdf, savePdf } from "../pdfdoc";
import { buildPdf } from "../../textpdf/docbuilder";

type PdfDoc = Awaited<ReturnType<typeof loadPdf>>;

/** Resolve a bookmark destination to a 1-based page number.
 * Array-form destinations carry the target page's indirect reference; we
 * match it against the document's pages. Named destinations and exotic
 * forms read as page 1 so the title survives with an honest fallback. */
function destPageNumber(doc: PdfDoc, destRaw: unknown): number {
  // The destination may be a direct array or stored behind an indirect ref.
  // Untyped `lookup(ref)` dereferences without throwing on shape, unlike
  // `lookupMaybe(ref, type)` which rejects mismatched types.
  const target = destRaw instanceof PDFRef ? doc.context.lookup(destRaw) : destRaw;
  if (target instanceof PDFArray && target.size() > 0) {
    const first = target.get(0);
    if (first instanceof PDFRef) {
      const pages = doc.getPages();
      for (let i = 0; i < pages.length; i++) {
        if (pages[i].ref.objectNumber === first.objectNumber) return i + 1;
      }
    }
  }
  return 1;
}

/** Read one outline node's destination: /Dest direct or /A GoTo action /D. */
function nodePage(doc: PdfDoc, node: PDFDict): number {
  const direct = node.get(PDFName.of("Dest"));
  if (direct) return destPageNumber(doc, direct);
  const action = node.lookupMaybe(PDFName.of("A"), PDFDict);
  if (action) {
    const d = action.get(PDFName.of("D"));
    if (d) return destPageNumber(doc, d);
  }
  return 1;
}

function decodeTitle(title: unknown): string {
  if (title instanceof PDFHexString) return title.decodeText();
  if (title instanceof PDFString) return title.asString();
  return "";
}

/** Walk an outline level: each node's /Next sibling chain, /First children. */
function readOutlineNode(doc: PdfDoc, ref: PDFRef): BookmarkNode[] {
  const out: BookmarkNode[] = [];
  let current: PDFRef | undefined = ref;
  while (current) {
    const node: PDFDict | undefined = doc.context.lookupMaybe(current, PDFDict);
    if (!node) break;
    const title = decodeTitle(node.get(PDFName.of("Title")));
    const children: BookmarkNode[] = [];
    const firstRaw: unknown = node.get(PDFName.of("First"));
    if (firstRaw instanceof PDFRef) {
      children.push(...readOutlineNode(doc, firstRaw));
    }
    out.push({ title, page: nodePage(doc, node), children });
    const nextRaw: unknown = node.get(PDFName.of("Next"));
    current = nextRaw instanceof PDFRef ? nextRaw : undefined;
  }
  return out;
}

/** Read the document's outline as a BookmarkNode tree (1-based pages).
 * A PDF with no outline reads as an empty tree. The catalog's /Outlines may
 * be stored as an indirect ref or inlined as a direct dict; both are read. */
export function readBookmarks(doc: PdfDoc): BookmarkNode[] {
  const catalog = doc.catalog;
  const raw: unknown = catalog.get(PDFName.of("Outlines"));
  let outlines: PDFDict | undefined;
  if (raw instanceof PDFRef) {
    outlines = doc.context.lookupMaybe(raw, PDFDict);
  } else if (raw instanceof PDFDict) {
    outlines = raw;
  }
  if (!outlines) return [];
  const firstRaw: unknown = outlines.get(PDFName.of("First"));
  if (!(firstRaw instanceof PDFRef)) return [];
  return readOutlineNode(doc, firstRaw);
}

/** Build a fresh /Outlines name tree from BookmarkNode[] and wire the
 * catalog. Any existing outline is replaced wholesale. */
function writeBookmarks(doc: PdfDoc, nodes: BookmarkNode[]): void {
  const ctx = doc.context;

  const buildNode = (node: BookmarkNode, parentRef: PDFRef): PDFRef => {
    // `ctx.obj({})` creates a PDFDict; the constructor itself is protected.
    const dict = ctx.obj({}) as PDFDict;
    dict.set(PDFName.of("Title"), PDFHexString.fromText(node.title));
    const page = doc.getPage(Math.min(node.page, doc.getPageCount()) - 1);
    dict.set(PDFName.of("Parent"), parentRef);
    dict.set(PDFName.of("Dest"), ctx.obj([page.ref, PDFName.of("Fit")]));
    // Register this node first so children can link to its ref.
    const selfRef = ctx.register(dict);

    if (node.children.length > 0) {
      const childRefs = node.children.map((child) => buildNode(child, selfRef));
      dict.set(PDFName.of("First"), childRefs[0]);
      dict.set(PDFName.of("Last"), childRefs[childRefs.length - 1]);
      dict.set(PDFName.of("Count"), PDFNumber.of(childRefs.length));
      childRefs.forEach((childRef, i) => {
        const child = ctx.lookup(childRef, PDFDict);
        if (i > 0) child.set(PDFName.of("Prev"), childRefs[i - 1]);
        if (i < childRefs.length - 1) child.set(PDFName.of("Next"), childRefs[i + 1]);
      });
    }
    return selfRef;
  };

  if (nodes.length === 0) {
    doc.catalog.delete(PDFName.of("Outlines"));
    return;
  }

  const outlines = ctx.obj({}) as PDFDict;
  const outlinesRef = ctx.register(outlines);
  const topRefs = nodes.map((node) => {
    const ref = buildNode(node, outlinesRef);
    return ref;
  });
  outlines.set(PDFName.of("First"), topRefs[0]);
  outlines.set(PDFName.of("Last"), topRefs[topRefs.length - 1]);
  outlines.set(PDFName.of("Count"), PDFNumber.of(nodes.length));
  topRefs.forEach((ref, i) => {
    const dict = ctx.lookup(ref, PDFDict);
    if (i > 0) dict.set(PDFName.of("Prev"), topRefs[i - 1]);
    if (i < topRefs.length - 1) dict.set(PDFName.of("Next"), topRefs[i + 1]);
  });
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
}

export async function runViewBookmarks(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<object> {
  void outDir;
  const { filePath } = ViewBookmarksInputSchema.parse(input);
  assertNotCancelled(ctx);
  const doc = await loadPdf(filePath, { updateMetadata: false });
  const bookmarks = readBookmarks(doc);
  return { bookmarks };
}

export async function runEditBookmarks(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, bookmarks } = EditBookmarksInputSchema.parse(input);
  assertNotCancelled(ctx);
  const doc = await loadPdf(filePath, { updateMetadata: false });
  writeBookmarks(doc, bookmarks);
  return savePdf(doc, outDir, "bookmarks.pdf");
}

/** Leader dots between title and page number, trimmed to a fixed column. */
function tocLine(title: string, page: number, indent: number): string {
  const label = "  ".repeat(indent) + title + " ";
  const number = String(page);
  const width = 60;
  const dots = Math.max(3, width - label.length - number.length);
  return `${label}${".".repeat(dots)} ${number}`;
}

export async function runToc(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const { filePath, position, title } = TocInputSchema.parse(input);
  assertNotCancelled(ctx);
  const doc = await loadPdf(filePath, { updateMetadata: false });
  const bookmarks = readBookmarks(doc);
  if (bookmarks.length === 0) {
    throw invalidInput("No bookmarks found in this file");
  }

  ctx.notifyProgress({ jobId: "", percent: 40, stage: "toc", pagesDone: 0 });

  // Numbers shown are the bookmark's stored (semantic) page numbers. When the
  // TOC is inserted at the beginning, the viewer's physical page numbers shift
  // by one; the UI hint explains this.
  const tocBytes = await buildPdf({ fontSize: 12, margins: 56 }, (kit) => {
    kit.fontSize(20).text(title, { align: "center" });
    kit.moveDown(1.5);
    const render = (nodes: BookmarkNode[], depth: number) => {
      for (const node of nodes) {
        kit
          .fontSize(12)
          .text(tocLine(node.title, node.page, depth), kit.page.margins.left, kit.y, {
            width: kit.page.width - kit.page.margins.left - kit.page.margins.right,
            lineBreak: false,
            ellipsis: false,
          });
        kit.moveDown(0.35);
        if (node.children.length > 0) render(node.children, depth + 1);
      }
    };
    render(bookmarks, 0);
  });

  ctx.notifyProgress({ jobId: "", percent: 80, stage: "toc", pagesDone: 1 });

  const tocDoc = await PDFDocument.load(tocBytes);
  const insertAt = position === "beginning" ? 0 : Math.min(1, doc.getPageCount() - 1);
  const copied = await doc.copyPages(
    tocDoc,
    tocDoc.getPageIndices()
  );
  copied.forEach((page) => doc.insertPage(insertAt, page));

  return savePdf(doc, outDir, "toc.pdf");
}