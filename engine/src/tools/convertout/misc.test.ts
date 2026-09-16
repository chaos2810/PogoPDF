import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptedPdfBytes, fixtureDir, makePdf } from "../../testing/fixtures";
import { runPdfToSvg } from "./pdftosvg";
import { runPdfToCbz } from "./pdftocbz";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-test-"));
}

function startsWith(buf: Buffer, bytes: number[]): boolean {
  return bytes.every((b, i) => buf[i] === b);
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("runPdfToSvg", () => {
  let dir: string;
  let two: string;

  beforeAll(async () => {
    dir = fixtureDir("convertout-misc");
    two = await makePdf(join(dir, "svg-two.pdf"), 2);
  });

  it("writes one basename-{n}.svg per page", async () => {
    const out = await runPdfToSvg({ filePath: two }, ctx, outDir());
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(2);
    expect(out[0].endsWith("svg-two-1.svg")).toBe(true);
    expect(out[1].endsWith("svg-two-2.svg")).toBe(true);
  });

  it("emits a page-sized SVG document wrapping the rendered PNG", async () => {
    const out = await runPdfToSvg({ filePath: two }, ctx, outDir());
    const svg = readFileSync(out[0], "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    // A4 page at scale 1 => 595.28 x 841.89 pt.
    expect(svg).toContain('viewBox="0 0 595.28 841.89"');
    expect(svg).toContain('width="595.28pt"');
    expect(svg).toContain('height="841.89pt"');
    // Raster wrap path (pdf.js 6 has no vector backend): self-contained PNG.
    expect(svg).toContain("<image");
    expect(svg).toContain("data:image/png;base64,");
    // Both the SVG2 href and the legacy xlink:href are emitted for viewers
    // that only honour one of them.
    expect(svg).toContain("<image href=");
    expect(svg).toContain('xlink:href="data:image/png;base64,');
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("renders only the selected pages, named by position in the selection", async () => {
    const out = await runPdfToSvg({ filePath: two, pages: "1" }, ctx, outDir());
    expect(out).toHaveLength(1);
    expect(out[0].endsWith("svg-two-1.svg")).toBe(true);
  });

  it("reports progress per page, ending at 100", async () => {
    const events: number[] = [];
    await runPdfToSvg(
      { filePath: two },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events.length).toBe(2);
    expect(events[events.length - 1]).toBe(100);
  });

  it("throws CANCELLED when cancelled after the first page", async () => {
    let cancelled = false;
    const cancelCtx = {
      ...ctx,
      cancelled: () => cancelled,
      notifyProgress: () => {
        cancelled = true;
      },
    };
    await expect(runPdfToSvg({ filePath: two }, cancelCtx, outDir())).rejects.toMatchObject({
      code: -32005,
    });
  });
});

describe("runPdfToCbz", () => {
  let dir: string;
  let two: string;

  beforeAll(async () => {
    dir = fixtureDir("convertout-misc");
    two = await makePdf(join(dir, "cbz-two.pdf"), 2);
  });

  it("writes a single basename.cbz with PK magic", async () => {
    const out = await runPdfToCbz({ filePath: two }, ctx, outDir());
    expect(Array.isArray(out)).toBe(false);
    expect(out.endsWith("cbz-two.cbz")).toBe(true);
    const buf = readFileSync(out);
    expect(startsWith(buf, [0x50, 0x4b, 0x03, 0x04])).toBe(true);
    // Local file header compression method (offset 8): 8 = DEFLATE.
    expect(buf.readUInt16LE(8)).toBe(8);
  });

  it("contains one PNG per page, zero-padded and sorted", async () => {
    const out = await runPdfToCbz({ filePath: two }, ctx, outDir());
    const zip = await JSZip.loadAsync(readFileSync(out));
    const names = Object.keys(zip.files).sort();
    expect(names).toHaveLength(2);
    expect(names).toEqual(["page-001.png", "page-002.png"]);
    for (const name of names) {
      const buf = await zip.files[name].async("nodebuffer");
      expect(startsWith(buf, PNG_MAGIC)).toBe(true);
    }
  });

  it("scales page PNGs to the requested dpi", async () => {
    const out = await runPdfToCbz({ filePath: two, dpi: 150 }, ctx, outDir());
    const zip = await JSZip.loadAsync(readFileSync(out));
    const buf = await zip.files["page-001.png"].async("nodebuffer");
    const { width, height } = pngSize(buf);
    expect(width).toBe(Math.floor(595.28 * (150 / 72)));
    expect(height).toBe(Math.floor(841.89 * (150 / 72)));
  });

  it("reports progress per page, ending at 100", async () => {
    const events: number[] = [];
    await runPdfToCbz(
      { filePath: two },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir()
    );
    expect(events.length).toBe(2);
    expect(events[events.length - 1]).toBe(100);
  });

  it("throws CANCELLED when cancelled after the first page", async () => {
    let cancelled = false;
    const cancelCtx = {
      ...ctx,
      cancelled: () => cancelled,
      notifyProgress: () => {
        cancelled = true;
      },
    };
    await expect(runPdfToCbz({ filePath: two }, cancelCtx, outDir())).rejects.toMatchObject({
      code: -32005,
    });
  });
});

describe("misc typed errors", () => {
  it("maps an encrypted PDF to ENCRYPTED_PDF through both tools", async () => {
    const enc = join(fixtureDir("convertout-misc"), "encrypted.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(runPdfToSvg({ filePath: enc }, ctx, outDir())).rejects.toMatchObject({
      code: -32002,
    });
    await expect(runPdfToCbz({ filePath: enc }, ctx, outDir())).rejects.toMatchObject({
      code: -32002,
    });
  });
});
