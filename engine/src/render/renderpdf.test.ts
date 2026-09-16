import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fixtureDir, makePdf } from "../testing/fixtures";
import { getPdfRenderer, resolveStandardFontDataUrl } from "./renderpdf";
import { encodeCanvas } from "./encode";
import { extractAllText, extractPageText } from "./textextract";
import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";

const dir = fixtureDir("render");

function startsWith(buf: Buffer, bytes: number[]): boolean {
  return bytes.every((b, i) => buf[i] === b);
}

function nonWhitePixels(canvas: Canvas): number {
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) count++;
  }
  return count;
}

describe("getPdfRenderer", () => {
  it("renders a 2-page A4 fixture at 150dpi to correctly sized canvases", async () => {
    const path = join(dir, "a4-2page.pdf");
    await makePdf(path, 2);
    const renderer = await getPdfRenderer(path);
    try {
      expect(renderer.pageCount).toBe(2);
      for (let i = 0; i < 2; i++) {
        const canvas = await renderer.renderPage(i, 150);
        // A4 (595.28x841.89pt) at scale 150/72 = 1240.17x1753.94; @napi-rs/canvas
        // truncates the fractional viewport size, so 1240x1753 is exact here.
        expect(canvas.width).toBe(1240);
        expect(canvas.height).toBe(1753);
      }
    } finally {
      await renderer.close();
    }
  });

  it("paints actual text pixels (standard fonts resolve)", async () => {
    const path = join(dir, "text.pdf");
    await makePdf(path, 1);
    const renderer = await getPdfRenderer(path);
    try {
      const canvas = await renderer.renderPage(0, 150);
      expect(nonWhitePixels(canvas)).toBeGreaterThan(1000);
    } finally {
      await renderer.close();
    }
  });

  it("resolves standardFontDataUrl to the pdfjs-dist font directory", async () => {
    // verbosity:0 in getPdfRenderer suppresses pdf.js's "standardFontDataUrl
    // not provided" warning, so assert the wiring directly: if this path were
    // wrong, pdf.js would silently fall back to substitute glyphs.
    const url = resolveStandardFontDataUrl();
    expect(url).toBeDefined();
    expect(url!.endsWith("/")).toBe(true);
    expect(existsSync(join(url!, "LiberationSans-Regular.ttf"))).toBe(true);
    expect(existsSync(join(url!, "FoxitSerif.pfb"))).toBe(true);
  });

  it("renders at a larger dpi to a proportionally larger canvas", async () => {
    const path = join(dir, "dpi.pdf");
    await makePdf(path, 1);
    const renderer = await getPdfRenderer(path);
    try {
      const at72 = await renderer.renderPage(0, 72);
      const at300 = await renderer.renderPage(0, 300);
      expect(at300.width / at72.width).toBeCloseTo(300 / 72, 1);
    } finally {
      await renderer.close();
    }
  });
});

describe("encodeCanvas", () => {
  const formats = ["jpg", "png", "webp", "tiff", "bmp"] as const;

  it.each(formats)("encodes %s with correct magic bytes", async (format) => {
    const path = join(dir, "encode.pdf");
    await makePdf(path, 1);
    const renderer = await getPdfRenderer(path);
    try {
      const canvas = await renderer.renderPage(0, 72);
      const buf = await encodeCanvas(canvas, format);
      expect(buf.length).toBeGreaterThan(0);
      switch (format) {
        case "png":
          expect(startsWith(buf, [0x89, 0x50, 0x4e, 0x47])).toBe(true);
          break;
        case "jpg":
          expect(startsWith(buf, [0xff, 0xd8])).toBe(true);
          break;
        case "webp":
          expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
          expect(buf.subarray(8, 12).toString("ascii")).toBe("WEBP");
          break;
        case "tiff":
          expect(["II", "MM"]).toContain(buf.subarray(0, 2).toString("ascii"));
          break;
        case "bmp":
          expect(buf.subarray(0, 2).toString("ascii")).toBe("BM");
          break;
      }
    } finally {
      await renderer.close();
    }
  });

  it("encodes a BMP with correct header dimensions", async () => {
    const path = join(dir, "bmp.pdf");
    await makePdf(path, 1);
    const renderer = await getPdfRenderer(path);
    try {
      const canvas = await renderer.renderPage(0, 72);
      const buf = await encodeCanvas(canvas, "bmp");
      expect(buf.readUInt16LE(0)).toBe(0x4d42);
      const pixelOffset = buf.readUInt32LE(10);
      const headerSize = buf.readUInt32LE(14);
      expect(headerSize).toBe(40);
      expect(buf.readInt32LE(18)).toBe(canvas.width);
      expect(buf.readInt32LE(22)).toBe(canvas.height);
      const rowBytes = Math.ceil((canvas.width * 3) / 4) * 4;
      expect(buf.length).toBe(pixelOffset + rowBytes * canvas.height);

      // sharp has no BMP loader, so decode the written file with @napi-rs/canvas
      // (an independent decoder) to prove the header and rows parse.
      const decoded = await loadImage(buf);
      expect(decoded.width).toBe(canvas.width);
      expect(decoded.height).toBe(canvas.height);
      const check = createCanvas(canvas.width, canvas.height);
      const checkCtx = check.getContext("2d");
      checkCtx.drawImage(decoded, 0, 0);
      const { data } = checkCtx.getImageData(0, 0, canvas.width, canvas.height);

      // Fixture text sits near the top of the page, so a correctly oriented
      // (bottom-up -> top-down) BMP must have its dark pixels in the top half.
      let topDark = 0;
      let bottomDark = 0;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          const dark = data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128;
          if (dark) (y < canvas.height / 2 ? topDark++ : bottomDark++);
        }
      }
      expect(topDark).toBeGreaterThan(0);
      expect(topDark).toBeGreaterThan(bottomDark);
    } finally {
      await renderer.close();
    }
  });

  it("pads odd-width BMP rows to a 4-byte boundary", async () => {
    const path = join(dir, "bmp-odd.pdf");
    await makePdf(path, 1, { sizes: [[101, 100]] });
    const renderer = await getPdfRenderer(path);
    try {
      const canvas = await renderer.renderPage(0, 72);
      expect(canvas.width).toBe(101);
      const buf = await encodeCanvas(canvas, "bmp");
      const rowBytes = Math.ceil((101 * 3) / 4) * 4;
      expect(rowBytes).toBe(304);
      expect(buf.length).toBe(54 + rowBytes * canvas.height);
      const decoded = await loadImage(buf);
      expect(decoded.width).toBe(101);
      expect(decoded.height).toBe(canvas.height);
    } finally {
      await renderer.close();
    }
  });

  it("honours the quality parameter for lossy formats", async () => {
    const path = join(dir, "quality.pdf");
    await makePdf(path, 1);
    const renderer = await getPdfRenderer(path);
    try {
      const canvas = await renderer.renderPage(0, 150);
      const low = await encodeCanvas(canvas, "jpg", 10);
      const high = await encodeCanvas(canvas, "jpg", 95);
      expect(high.length).toBeGreaterThan(low.length);
      // quality omitted must still produce a valid jpeg (default applied)
      const def = await encodeCanvas(canvas, "jpg");
      expect(startsWith(def, [0xff, 0xd8])).toBe(true);
    } finally {
      await renderer.close();
    }
  });
});

describe("text extraction", () => {
  it("extracts per-page text and joins pages with form feed", async () => {
    const path = join(dir, "text-extract.pdf");
    await makePdf(path, 2);
    const renderer = await getPdfRenderer(path);
    try {
      const page1 = await extractPageText(await renderer.getPage(0));
      const page2 = await extractPageText(await renderer.getPage(1));
      expect(page1).toContain("Page 1");
      expect(page2).toContain("Page 2");
      expect(page1).not.toContain("Page 2");
    } finally {
      await renderer.close();
    }
  });

  it("extracts all text with form feeds and reports per-page progress", async () => {
    const path = join(dir, "text-all.pdf");
    await makePdf(path, 3);
    const renderer = await getPdfRenderer(path);
    try {
      const seen: number[] = [];
      const text = await extractAllText(renderer, (pageIndex) => seen.push(pageIndex));
      expect(text).toContain("Page 1");
      expect(text).toContain("Page 3");
      expect(text.split("\f")).toHaveLength(3);
      expect(seen).toEqual([0, 1, 2]);
    } finally {
      await renderer.close();
    }
  });
});
