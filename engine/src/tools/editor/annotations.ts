import {
  PDFDict,
  PDFName,
  PDFNumber,
  PDFString,
} from "pdf-lib";
import type { PDFDocument, PDFFont, PDFPage } from "pdf-lib";
import { degrees } from "pdf-lib";
import type { Annotation } from "@pogopdf/contracts";
import {
  displayedPageSize,
  toUnrotated,
} from "../../render/pagegeometry";
import { assertNotCancelled, invalidInput, normalizeAngle } from "../organize/organize";
import { loadImageEmbeddable } from "../../render/decode";
import { embedStandardFont, encodeFailure, parseHexColor } from "../edit/pagedraw";

type PdfDoc = PDFDocument;

const CANONICAL = new Set([0, 90, 180, 270]);

/** Page geometry in the viewer's DISPLAYED frame (rotation aware). */
type DisplayedPage = {
  rotation: number;
  mediaW: number;
  mediaH: number;
  dispW: number;
  dispH: number;
};

function displayedPage(doc: PdfDoc, pageIndex: number): DisplayedPage {
  const page = doc.getPage(pageIndex);
  const raw = normalizeAngle(page.getRotation().angle);
  const rotation = CANONICAL.has(raw) ? raw : 0;
  const { width: mediaW, height: mediaH } = page.getSize();
  const { width: dispW, height: dispH } = displayedPageSize(rotation, mediaW, mediaH);
  return { rotation, mediaW, mediaH, dispW, dispH };
}

/** A displayed-frame point (x from left, y from top) in unrotated user space. */
function toUser(disp: DisplayedPage, rx: number, ry: number): { x: number; y: number } {
  return toUnrotated(disp.rotation, disp.mediaW, disp.mediaH, rx, ry);
}

/** A displayed rect as the smallest unrotated user-space box containing it. */
function toUserRect(
  disp: DisplayedPage,
  rect: { x: number; y: number; w: number; h: number }
): { x1: number; y1: number; x2: number; y2: number } {
  const a = toUser(disp, rect.x, rect.y);
  const b = toUser(disp, rect.x + rect.w, rect.y + rect.h);
  return {
    x1: Math.min(a.x, b.x),
    y1: Math.min(a.y, b.y),
    x2: Math.max(a.x, b.x),
    y2: Math.max(a.y, b.y),
  };
}

/** [x1 y1 x2 y2] for an annot /Rect. */
function rectArray(r: { x1: number; y1: number; x2: number; y2: number }): number[] {
  return [r.x1, r.y1, r.x2, r.y2];
}

/** Clamped integer font size; the engine owns the bound (contracts has none). */
function clampFontSize(size: number): number {
  return Math.min(96, Math.max(4, Math.round(size)));
}

function rgbArray(hex: string): number[] {
  const c = parseHexColor(hex);
  return [c.r, c.g, c.b];
}

/** /F 4: the print flag, so viewers show every annot. */
function commonAnnot(dict: PDFDict, subtype: string, color: number[], opacity: number): void {
  dict.set(PDFName.of("Type"), PDFName.of("Annot"));
  dict.set(PDFName.of("Subtype"), PDFName.of(subtype));
  dict.set(PDFName.of("F"), PDFNumber.of(4));
  dict.set(PDFName.of("C"), dict.context.obj(color));
  dict.set(PDFName.of("CA"), PDFNumber.of(opacity));
  dict.set(PDFName.of("T"), PDFString.of("PogoPDF"));
}

function registerAnnot(doc: PdfDoc, page: PDFPage, dict: PDFDict): void {
  page.node.addAnnot(doc.context.register(dict));
}

/**
 * Add the FreeText default-appearance font to a page's /Font resources and
 * return the resource key the /DA string must reference. One key per page,
 * since pdf-lib generates a unique name per page's font dict.
 */
function ensureFontKey(
  page: PDFPage,
  cache: Map<number, PDFName>,
  pageIndex: number,
  font: PDFFont
): PDFName {
  const cached = cache.get(pageIndex);
  if (cached) return cached;
  const key = page.node.newFontDictionaryKey("Helv");
  page.node.setFontDictionary(key, font.ref);
  cache.set(pageIndex, key);
  return key;
}

/**
 * /DR default resources for a FreeText annot, holding the same font under the
 * same key that its /DA references. Viewers resolve the DA font from here; the
 * page /Font dict alone is not enough for annotation text.
 */
function defaultResources(dict: PDFDict, fontKey: PDFName, font: PDFFont): PDFDict {
  const fonts = dict.context.obj({}) as PDFDict;
  fonts.set(fontKey, font.ref);
  const dr = dict.context.obj({}) as PDFDict;
  dr.set(PDFName.of("Font"), fonts);
  return dr;
}

/** Displayed-frame endpoints of a line/arrow rect: top-left to bottom-right. */
function lineEndpoints(
  disp: DisplayedPage,
  rect: { x: number; y: number; w: number; h: number }
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  return {
    start: toUser(disp, rect.x, rect.y),
    end: toUser(disp, rect.x + rect.w, rect.y + rect.h),
  };
}

function lineBBox(a: { x: number; y: number }, b: { x: number; y: number }): number[] {
  return [
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x, b.x),
    Math.max(a.y, b.y),
  ];
}

/** The two arrowhead legs at `tip`, pointing back along the line. */
function arrowLegs(
  start: { x: number; y: number },
  end: { x: number; y: number }
): Array<{ start: { x: number; y: number }; end: { x: number; y: number } }> {
  const dx = start.x - end.x;
  const dy = start.y - end.y;
  const len = Math.hypot(dx, dy) || 1;
  const legLength = Math.min(len * 0.3, 18);
  const theta = (30 * Math.PI) / 180;
  const legs: Array<{ start: { x: number; y: number }; end: { x: number; y: number } }> = [];
  for (const sign of [1, -1]) {
    const angle = Math.atan2(dy / len, dx / len) + sign * theta;
    legs.push({
      start: end,
      end: { x: end.x + Math.cos(angle) * legLength, y: end.y + Math.sin(angle) * legLength },
    });
  }
  return legs;
}

function writeLine(
  doc: PdfDoc,
  page: PDFPage,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: number[],
  opacity: number,
  width: number
): void {
  const dict = doc.context.obj({}) as PDFDict;
  commonAnnot(dict, "Line", color, opacity);
  dict.set(PDFName.of("Rect"), dict.context.obj(lineBBox(from, to)));
  dict.set(PDFName.of("L"), dict.context.obj([from.x, from.y, to.x, to.y]));
  dict.set(PDFName.of("BS"), dict.context.obj({ W: width }));
  registerAnnot(doc, page, dict);
}

/**
 * QuadPoints in the PDF spec order for one quad: upper-left, upper-right,
 * lower-left, lower-right. A single-line mark is one quad (8 numbers).
 */
function quadPoints(r: { x1: number; y1: number; x2: number; y2: number }): number[] {
  return [r.x1, r.y2, r.x2, r.y2, r.x1, r.y1, r.x2, r.y1];
}

/**
 * Write every normalized annotation into `doc` as a real PDF annotation (or,
 * for image marks, page content). Coordinates arrive in the page's displayed
 * frame and are mapped to unrotated user space so a mark on a /Rotate page
 * lands where the viewer showed it.
 *
 * Redaction is deliberately rejected here: it is handled by `applyRedactions`,
 * and silently dropping a redact rect would be a correctness failure.
 */
export async function writeAnnotations(
  doc: PdfDoc,
  annotations: Annotation[],
  ctx: { cancelled: () => boolean }
): Promise<void> {
  const redact = annotations.find((a) => a.type === "redact");
  if (redact) {
    throw invalidInput("Redaction annotations must be applied through the redaction flow");
  }

  const pageCount = doc.getPageCount();
  for (const annot of annotations) {
    if (annot.page > pageCount) {
      throw invalidInput(`Annotation page ${annot.page} is out of range (1-${pageCount})`);
    }
  }

  const needsFont = annotations.some((a) => a.type === "text" || a.type === "freetext");
  const font = needsFont ? await embedStandardFont(doc) : undefined;
  const fontKeys = new Map<number, PDFName>();

  const byPage = new Map<number, Annotation[]>();
  for (const annot of annotations) {
    const list = byPage.get(annot.page) ?? [];
    list.push(annot);
    byPage.set(annot.page, list);
  }

  for (const [pageNumber, pageAnnots] of byPage) {
    assertNotCancelled(ctx);
    const pageIndex = pageNumber - 1;
    const page = doc.getPage(pageIndex);
    const disp = displayedPage(doc, pageIndex);

    for (const annot of pageAnnots) {
      const color = rgbArray(annot.color);

      switch (annot.type) {
        case "rect":
        case "ellipse": {
          const r = toUserRect(disp, annot.rect!);
          const dict = doc.context.obj({}) as PDFDict;
          commonAnnot(dict, annot.type === "rect" ? "Square" : "Circle", color, annot.opacity);
          dict.set(PDFName.of("Rect"), dict.context.obj(rectArray(r)));
          dict.set(PDFName.of("BS"), dict.context.obj({ W: annot.lineWidth }));
          registerAnnot(doc, page, dict);
          break;
        }

        case "line":
        case "arrow": {
          const { start, end } = lineEndpoints(disp, annot.rect!);
          writeLine(doc, page, start, end, color, annot.opacity, annot.lineWidth);
          if (annot.type === "arrow") {
            for (const leg of arrowLegs(start, end)) {
              writeLine(doc, page, leg.start, leg.end, color, annot.opacity, annot.lineWidth);
            }
          }
          break;
        }

        case "highlight":
        case "underline":
        case "strikeout": {
          const r = toUserRect(disp, annot.rect!);
          const dict = doc.context.obj({}) as PDFDict;
          const subtype =
            annot.type === "highlight"
              ? "Highlight"
              : annot.type === "underline"
                ? "Underline"
                : "StrikeOut";
          commonAnnot(dict, subtype, color, annot.opacity);
          dict.set(PDFName.of("Rect"), dict.context.obj(rectArray(r)));
          dict.set(PDFName.of("QuadPoints"), dict.context.obj(quadPoints(r)));
          dict.set(PDFName.of("IC"), dict.context.obj(color));
          registerAnnot(doc, page, dict);
          break;
        }

        case "freehand": {
          const points = annot.points!;
          const xs: number[] = [];
          const ys: number[] = [];
          const flat: number[] = [];
          for (const p of points) {
            const u = toUser(disp, p.x, p.y);
            xs.push(u.x);
            ys.push(u.y);
            flat.push(u.x, u.y);
          }
          const dict = doc.context.obj({}) as PDFDict;
          commonAnnot(dict, "Ink", color, annot.opacity);
          dict.set(PDFName.of("Rect"), dict.context.obj([
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...xs),
            Math.max(...ys),
          ]));
          dict.set(PDFName.of("InkList"), dict.context.obj([flat]));
          dict.set(PDFName.of("Intent"), PDFName.of("PD"));
          dict.set(PDFName.of("BS"), dict.context.obj({ W: annot.lineWidth }));
          registerAnnot(doc, page, dict);
          break;
        }

        case "text":
        case "freetext": {
          const text = annot.text!;
          let encoded;
          try {
            encoded = font!.encodeText(text);
          } catch (err) {
            throw encodeFailure(err) ?? err;
          }
          const r = toUserRect(disp, annot.rect!);
          const size = clampFontSize(annot.fontSize);
          const fontKey = ensureFontKey(page, fontKeys, pageIndex, font!);
          const [cr, cg, cb] = color;
          const da = `${fontKey.asString()} ${size} Tf ${cr.toFixed(4)} ${cg.toFixed(4)} ${cb.toFixed(4)} rg`;
          const dict = doc.context.obj({}) as PDFDict;
          commonAnnot(dict, "FreeText", color, annot.opacity);
          dict.set(PDFName.of("Rect"), dict.context.obj(rectArray(r)));
          dict.set(PDFName.of("Contents"), encoded);
          dict.set(PDFName.of("DA"), PDFString.of(da));
          dict.set(PDFName.of("DR"), defaultResources(dict, fontKey, font!));
          dict.set(PDFName.of("BS"), dict.context.obj({ W: annot.lineWidth }));
          registerAnnot(doc, page, dict);
          break;
        }

        case "image": {
          const loaded = await loadImageEmbeddable(annot.imagePath!);
          const image =
            loaded.kind === "jpg"
              ? await doc.embedJpg(loaded.bytes)
              : await doc.embedPng(loaded.bytes);
          const rect = annot.rect ?? { x: 0, y: 0, w: loaded.widthPx, h: loaded.heightPx };
          const cx = rect.x + rect.w / 2;
          const cy = rect.y + rect.h / 2;
          const center = toUser(disp, cx, cy);
          const rad = (disp.rotation * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const halfW = rect.w / 2;
          const halfH = rect.h / 2;
          // drawImage anchors at the image's lower-left then rotates about it,
          // so back the anchor off by the rotated half-extent to centre it.
          const anchor = {
            x: center.x - (halfW * cos - halfH * sin),
            y: center.y - (halfW * sin + halfH * cos),
          };
          page.drawImage(image, {
            x: anchor.x,
            y: anchor.y,
            width: rect.w,
            height: rect.h,
            opacity: annot.opacity,
            rotate: degrees(disp.rotation),
          });
          break;
        }

        case "redact":
          throw invalidInput("Redaction annotations must be applied through the redaction flow");
      }
    }
  }
}

/** The 1-based page numbers carrying at least one redact rect. */
export function redactedPages(annotations: Annotation[]): Set<number> {
  const pages = new Set<number>();
  for (const annot of annotations) {
    if (annot.type === "redact") pages.add(annot.page);
  }
  return pages;
}
