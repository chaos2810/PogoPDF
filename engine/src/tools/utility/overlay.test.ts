import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import {
  encryptedPdfBytes,
  fixtureDir,
  makePdfWithSplitColors,
} from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { runOverlay } from "./overlay";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-overlay-"));
}

/** RGBA at (x, y) of page 0 rendered at 72dpi. */
async function pixelAt(
  path: string,
  x: number,
  y: number
): Promise<[number, number, number, number]> {
  const renderer = await getPdfRenderer(path);
  try {
    const canvas = await renderer.renderPage(0, 72);
    const { data } = canvas.getContext("2d").getImageData(x, y, 1, 1);
    return [data[0], data[1], data[2], data[3]];
  } finally {
    await renderer.close();
  }
}

/** A one-page PDF with a single solid rectangle filling the whole page. */
async function makeSolidPdf(
  path: string,
  rgbColor: [number, number, number],
  size: [number, number] = [200, 200]
): Promise<string> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(size);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: size[0],
    height: size[1],
    color: rgb(rgbColor[0], rgbColor[1], rgbColor[2]),
  });
  writeFileSync(path, await doc.save());
  return path;
}

/** A one-page PDF with a small solid rectangle at the given unrotated rect. */
async function makePdfWithSmallRect(
  path: string,
  opts: {
    size: [number, number];
    rect: { x: number; y: number; w: number; h: number };
    rgbColor: [number, number, number];
    rotation?: number;
  }
): Promise<string> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(opts.size);
  page.drawRectangle({
    x: opts.rect.x,
    y: opts.rect.y,
    width: opts.rect.w,
    height: opts.rect.h,
    color: rgb(opts.rgbColor[0], opts.rgbColor[1], opts.rgbColor[2]),
  });
  if (opts.rotation) page.setRotation(degrees(opts.rotation));
  writeFileSync(path, await doc.save());
  return path;
}

describe("runOverlay", () => {
  let dir: string;

  beforeAll(() => {
    dir = fixtureDir("overlay");
  });

  it("draws the overlay on top of the base", async () => {
    // Base: red rectangle at the left. Overlay: a blue rectangle at the right
    // that must appear over any base content it covers.
    const base = await makePdfWithSmallRect(join(dir, "top-base.pdf"), {
      size: [200, 200],
      rect: { x: 0, y: 0, w: 200, h: 200 },
      rgbColor: [1, 0, 0],
    });
    const overlay = await makePdfWithSmallRect(join(dir, "top-over.pdf"), {
      size: [200, 200],
      rect: { x: 0, y: 0, w: 100, h: 100 },
      rgbColor: [0, 0, 1],
    });

    const out = await runOverlay(
      { baseFilePath: base, overlayFilePath: overlay, mode: "overlay" },
      ctx,
      outDir()
    );
    expect(out.endsWith("overlay.pdf")).toBe(true);

    // The overlay's bottom-left half is blue; the base's red shows elsewhere.
    const over = await pixelAt(out, 25, 175);
    expect(over[2]).toBeGreaterThan(200);
    expect(over[0]).toBeLessThan(80);
    const baseOnly = await pixelAt(out, 175, 25);
    expect(baseOnly[0]).toBeGreaterThan(200);
    expect(baseOnly[2]).toBeLessThan(80);
  });

  it("draws the underlay beneath the base's opaque content", async () => {
    // Base covers the left half with opaque red (rest white). Underlay is a
    // full-page blue: it must show only on the base's white right half.
    const base = await makePdfWithSmallRect(join(dir, "under-base.pdf"), {
      size: [200, 200],
      rect: { x: 0, y: 0, w: 100, h: 200 },
      rgbColor: [1, 0, 0],
    });
    const underlay = await makeSolidPdf(join(dir, "under-over.pdf"), [0, 0, 1], [200, 200]);

    const out = await runOverlay(
      { baseFilePath: base, overlayFilePath: underlay, mode: "underlay" },
      ctx,
      outDir()
    );

    // Left half: base red hides the underlay.
    const left = await pixelAt(out, 25, 100);
    expect(left[0]).toBeGreaterThan(200);
    expect(left[2]).toBeLessThan(80);
    // Right half: base is white, but the raster path has no white fill, so the
    // underlay's blue is visible.
    const right = await pixelAt(out, 175, 100);
    expect(right[2]).toBeGreaterThan(200);
    expect(right[0]).toBeLessThan(80);
  });

  it("repeats the last overlay page when it has fewer pages than the base", async () => {
    const baseDoc = await PDFDocument.create({ updateMetadata: false });
    for (let i = 0; i < 2; i++) {
      const p = baseDoc.addPage([200, 100]);
      p.drawRectangle({ x: 0, y: 0, width: 200, height: 100, color: rgb(1, 1, 1) });
    }
    writeFileSync(join(dir, "repeat-base2.pdf"), await baseDoc.save());
    const base2 = join(dir, "repeat-base2.pdf");

    const overlay = await makeSolidPdf(join(dir, "repeat-over.pdf"), [0, 1, 0], [200, 100]);

    const out = await runOverlay(
      { baseFilePath: base2, overlayFilePath: overlay, mode: "overlay" },
      ctx,
      outDir()
    );

    const doc = await PDFDocument.load(await readFile(out));
    expect(doc.getPageCount()).toBe(2);

    const renderer = await getPdfRenderer(out);
    try {
      // Both pages carry the repeated green overlay.
      for (let i = 0; i < 2; i++) {
        const canvas = await renderer.renderPage(i, 72);
        const d = canvas.getContext("2d").getImageData(100, 50, 1, 1).data;
        expect(d[1]).toBeGreaterThan(200);
        expect(d[0]).toBeLessThan(80);
      }
    } finally {
      await renderer.close();
    }
  });

  it("ignores extra overlay pages beyond the base's count", async () => {
    const base = await makeSolidPdf(join(dir, "extra-base.pdf"), [1, 1, 1], [200, 200]);
    const overlayDoc = await PDFDocument.create({ updateMetadata: false });
    for (const col of [
      [1, 0, 0] as [number, number, number],
      [0, 1, 0] as [number, number, number],
      [0, 0, 1] as [number, number, number],
    ]) {
      const p = overlayDoc.addPage([200, 200]);
      p.drawRectangle({ x: 0, y: 0, width: 200, height: 200, color: rgb(col[0], col[1], col[2]) });
    }
    const overlay = join(dir, "extra-over.pdf");
    writeFileSync(overlay, await overlayDoc.save());

    const out = await runOverlay(
      { baseFilePath: base, overlayFilePath: overlay, mode: "overlay" },
      ctx,
      outDir()
    );
    const doc = await PDFDocument.load(await readFile(out));
    expect(doc.getPageCount()).toBe(1);
    // Page 0 carries the first overlay page (red), not the later pages.
    const px = await pixelAt(out, 100, 100);
    expect(px[0]).toBeGreaterThan(200);
    expect(px[1]).toBeLessThan(80);
  });

  it("applies opacity to the overlay only", async () => {
    const base = await makeSolidPdf(join(dir, "op-base.pdf"), [1, 1, 1], [200, 200]);
    const overlay = await makeSolidPdf(join(dir, "op-over.pdf"), [0, 0, 0], [200, 200]);

    const out = await runOverlay(
      { baseFilePath: base, overlayFilePath: overlay, mode: "overlay", opacity: 0.5 },
      ctx,
      outDir()
    );
    // Black at 50% over white renders mid grey, not black.
    const px = await pixelAt(out, 100, 100);
    expect(px[0]).toBeGreaterThan(90);
    expect(px[0]).toBeLessThan(165);

    const opaque = await runOverlay(
      { baseFilePath: base, overlayFilePath: overlay, mode: "overlay" },
      ctx,
      outDir()
    );
    const solid = await pixelAt(opaque, 100, 100);
    expect(solid[0]).toBeLessThan(20);
  });

  it("scales the overlay to fit the base frame when scaleToFit is set", async () => {
    const base = await makeSolidPdf(join(dir, "fit-base.pdf"), [1, 1, 1], [200, 200]);
    // A small page: without fit it would sit at the displayed origin; with fit
    // it scales up to the full base frame.
    const overlay = await makeSolidPdf(join(dir, "fit-over.pdf"), [0, 0, 1], [50, 50]);

    const out = await runOverlay(
      { baseFilePath: base, overlayFilePath: overlay, mode: "overlay", scaleToFit: true },
      ctx,
      outDir()
    );
    // A point near the far corner is covered only if the overlay grew to fit.
    const far = await pixelAt(out, 190, 10);
    expect(far[2]).toBeGreaterThan(200);
    expect(far[0]).toBeLessThan(80);
  });

  it("aligns a rotated overlay with the base's displayed frame", async () => {
    // Base: 200x200 white. Overlay: 200x100 split (unrotated left blue, right
    // red) with /Rotate 90, so the viewer turns it clockwise: the displayed
    // page is 100x200 with blue on top and red on the bottom. The overlay is
    // drawn at the base's displayed origin, occupying the left half; the bars
    // must be stacked (aligned with the displayed frame), not side by side.
    const base = await makeSolidPdf(join(dir, "rot-base.pdf"), [1, 1, 1], [200, 200]);
    const overlay = await makePdfWithSplitColors(join(dir, "rot-over.pdf"), {
      width: 200,
      height: 100,
      rotation: 90,
    });

    const out = await runOverlay(
      { baseFilePath: base, overlayFilePath: overlay, mode: "overlay" },
      ctx,
      outDir()
    );
    const doc = await PDFDocument.load(await readFile(out));
    expect(doc.getPage(0).getWidth()).toBeCloseTo(200, 2);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(200, 2);

    const top = await pixelAt(out, 25, 25);
    const bottom = await pixelAt(out, 25, 175);
    // Blue bar on top, red bar on bottom.
    expect(top[2]).toBeGreaterThan(200);
    expect(top[0]).toBeLessThan(80);
    expect(bottom[0]).toBeGreaterThan(200);
    expect(bottom[2]).toBeLessThan(80);
  });

  it("aligns a rotated base page's content with a full-frame overlay", async () => {
    // Base 200x100 with /Rotate 90 displays 100x200. Overlay is a full
    // 100x200 blue page; it must cover the displayed base frame.
    const base = await makePdfWithSplitColors(join(dir, "rb-base.pdf"), {
      width: 200,
      height: 100,
      rotation: 90,
    });
    const overlay = await makeSolidPdf(join(dir, "rb-over.pdf"), [0, 0, 1], [100, 200]);

    const out = await runOverlay(
      { baseFilePath: base, overlayFilePath: overlay, mode: "overlay" },
      ctx,
      outDir()
    );
    const doc = await PDFDocument.load(await readFile(out));
    expect(doc.getPage(0).getWidth()).toBeCloseTo(100, 2);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(200, 2);

    // Whole displayed frame is blue.
    for (const [x, y] of [
      [50, 20],
      [50, 100],
      [50, 180],
    ]) {
      const px = await pixelAt(out, x, y);
      expect(px[2]).toBeGreaterThan(200);
    }
  });

  it("tolerates a contentless blank base page instead of failing to embed it", async () => {
    const blankDoc = await PDFDocument.create({ updateMetadata: false });
    blankDoc.addPage([200, 200]);
    const blank = join(dir, "blank-base.pdf");
    writeFileSync(blank, await blankDoc.save());
    const overlay = await makeSolidPdf(join(dir, "blank-over.pdf"), [0, 0, 1], [200, 200]);

    const out = await runOverlay(
      { baseFilePath: blank, overlayFilePath: overlay, mode: "overlay" },
      ctx,
      outDir()
    );
    const px = await pixelAt(out, 100, 100);
    expect(px[2]).toBeGreaterThan(200);
  });

  it("maps an encrypted input to ENCRYPTED_PDF", async () => {
    const enc = join(dir, "enc.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    const base = await makeSolidPdf(join(dir, "enc-base.pdf"), [1, 1, 1], [100, 100]);
    await expect(
      runOverlay({ baseFilePath: enc, overlayFilePath: base, mode: "overlay" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
  });

  it("reports progress per page, ending at 100", async () => {
    const base = await makeSolidPdf(join(dir, "prog-base.pdf"), [1, 1, 1], [100, 100]);
    const overlay = await makeSolidPdf(join(dir, "prog-over.pdf"), [0, 0, 1], [100, 100]);
    const events: number[] = [];
    await runOverlay(
      { baseFilePath: base, overlayFilePath: overlay, mode: "overlay" },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events).toEqual([100]);
  });

  it("throws CANCELLED when cancelled before the first page", async () => {
    const base = await makeSolidPdf(join(dir, "can-base.pdf"), [1, 1, 1], [100, 100]);
    const overlay = await makeSolidPdf(join(dir, "can-over.pdf"), [0, 0, 1], [100, 100]);
    await expect(
      runOverlay(
        { baseFilePath: base, overlayFilePath: overlay, mode: "overlay" },
        { ...ctx, cancelled: () => true },
        outDir()
      )
    ).rejects.toMatchObject({ code: -32005 });
  });
});
