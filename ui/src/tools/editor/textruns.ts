/**
 * Text-run geometry for the editor's in-place text edit (the editText tool).
 *
 * pdf.js reports each text item's transform in the page's UNROTATED user space
 * (origin bottom-left, y up) even on a /Rotate page: only the viewport applies
 * the rotation. editText's quad, by contrast, is the frame PyMuPDF uses: the
 * page's top-left origin with y growing DOWN (see EditTextInputSchema). Two
 * projections are therefore needed per run:
 *
 *   - `quad`: engine space, unrotated top-down, for the editText input.
 *   - `display`: the rendered page's displayed frame (x from the left, y from
 *     the top, /Rotate applied), for the on-canvas overlay and hit testing.
 *
 * The engine flip mirrors pagegeometry.toUnrotated; the display projection
 * reuses pdf.js's own viewport matrix, which is the authoritative rotation.
 */

export type Quad = { x: number; y: number; w: number; h: number };

/** The pdf.js TextItem fields this module reads (kept structural for tests). */
export type TextItemLike = {
  str: string;
  // [a, b, c, d, e, f]: e/f is the baseline origin, a/d the font scale.
  transform: number[];
  // Advance width in unrotated user-space units.
  width: number;
  fontName: string;
};

export type TextStyleLike = { ascent?: number; descent?: number };

/** Glyph extent (top/bottom of the line box) around a baseline origin. */
function glyphExtent(
  item: TextItemLike,
  style: TextStyleLike | undefined
): { size: number; topUser: number; bottomUser: number } | null {
  if (!item.str.trim()) return null;
  const [a, b, c, d, , f] = item.transform;
  // Non-horizontal text (b/c rotation terms) is skipped: the quad convention
  // has no way to express it and the tool redacts an axis-aligned box.
  if (Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3) return null;
  const size = Math.abs(d) || Math.abs(a);
  if (size <= 0 || item.width <= 0) return null;
  const ascent = style?.ascent ?? 0.8;
  const descent = style?.descent ?? -0.2;
  return { size, topUser: f + ascent * size, bottomUser: f + descent * size };
}

/**
 * The unrotated top-down quad for one horizontal text item, or null when the
 * item is empty or not axis-aligned horizontal. `mediaHeight` is the unrotated
 * page height in points; it flips the baseline's bottom-up y into the top-down
 * frame editText expects.
 */
export function quadFromItem(
  item: TextItemLike,
  style: TextStyleLike | undefined,
  mediaHeight: number
): Quad | null {
  const ext = glyphExtent(item, style);
  if (!ext) return null;
  const e = item.transform[4];
  return {
    x: e,
    y: mediaHeight - ext.topUser,
    w: item.width,
    h: ext.topUser - ext.bottomUser,
  };
}

/**
 * The displayed-frame rect for one horizontal text item, using a pdf.js
 * viewport transform [a, b, c, d, e, f] (scale 1, /Rotate applied). The four
 * glyph corners in unrotated y-up space are mapped and their bounding box
 * returned, so the rect tracks the page's rotation.
 */
export function displayRectFromItem(
  item: TextItemLike,
  style: TextStyleLike | undefined,
  transform: number[]
): Quad | null {
  const ext = glyphExtent(item, style);
  if (!ext) return null;
  const [a, b, c, d, e, f] = transform;
  const ox = item.transform[4];
  const corners: Array<[number, number]> = [
    [ox, ext.topUser],
    [ox + item.width, ext.topUser],
    [ox, ext.bottomUser],
    [ox + item.width, ext.bottomUser],
  ];
  const xs = corners.map(([x, y]) => a * x + c * y + e);
  const ys = corners.map(([x, y]) => b * x + d * y + f);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

export type TextRun = {
  text: string;
  /** Engine-ready quad (unrotated, top-left origin, y down). */
  quad: Quad;
  /** Where the run sits on the rotated, rendered page (displayed frame). */
  display: Quad;
};

/** The text run under a displayed-frame point, or null. */
export function hitTestRun(
  runs: TextRun[],
  pt: { x: number; y: number },
  tol = 2
): TextRun | null {
  // Later runs win: a line drawn over another is the one on top.
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i].display;
    if (
      pt.x >= r.x - tol &&
      pt.x <= r.x + r.w + tol &&
      pt.y >= r.y - tol &&
      pt.y <= r.y + r.h + tol
    ) {
      return runs[i];
    }
  }
  return null;
}
