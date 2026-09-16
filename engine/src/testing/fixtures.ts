import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

// A genuine AES-128 encrypted PDF (2 blank pages, user+owner password "secret").
// pdf-lib cannot create encrypted PDFs, so this is a checked-in literal. Generated
// once with pypdf 6.16.2 (Python 3.11) — qpdf/mutool were not available:
//   w = pypdf.PdfWriter(); w.add_blank_page(width=200, height=100)
//   w.add_blank_page(width=201, height=100)
//   w.encrypt(user_password="secret", owner_password="secret", algorithm="AES-128")
const ENCRYPTED_PDF_BASE64 =
  "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPGNkOGRlMDhmNWM0NTA1YmE3NTFiMWUxNDhkN2RiZDM4NDVhZDYyZTA3MDViMDhkYWQyYTQ5NTU1NjczZGE5Mzg+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMgovS2lkcyBbIDQgMCBSIDUgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAyMDAgMTAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8Cj4+Ci9NZWRpYUJveCBbIDAuMCAwLjAgMjAxIDEwMCBdCi9QYXJlbnQgMiAwIFIKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL1YgNAovUiA0Ci9MZW5ndGggMTI4Ci9QIDQyOTQ5NjcyOTIKL0ZpbHRlciAvU3RhbmRhcmQKL08gPDBlNTIyOTI1YTNlNGU4NzRjM2NmYWNiZWY1MTFhNzNhYzRlYzJiZDg2NWRjZDNkNDYyNzYxNDkxN2FiZmQ3ZTQ+Ci9VIDxlMjg0ZTJjMzE5MGRhY2U2NmJmN2IxMTYzN2JiMmIyYjI4YmY0ZTVlNGU3NThhNDE2NDAwNGU1NmZmZmEwMTA4PgovQ0YgPDwKL1N0ZENGIDw8Ci9BdXRoRXZlbnQgL0RvY09wZW4KL0NGTSAvQUVTVjIKL0xlbmd0aCAxNgo+Pgo+PgovU3RtRiAvU3RkQ0YKL1N0ckYgL1N0ZENGCj4+CmVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDExMyAwMDAwMCBuIAowMDAwMDAwMTc4IDAwMDAwIG4gCjAwMDAwMDAyMjcgMDAwMDAgbiAKMDAwMDAwMDMyMSAwMDAwMCBuIAowMDAwMDAwNDE1IDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNwovUm9vdCAzIDAgUgovSW5mbyAxIDAgUgovSUQgWyA8NjEzMjYzMzkzNDM3MzUzOTM1NjIzODMxMzAzODM5NjE2MTY1NjE2NjM4MzgzMTM4NjU2NjY0MzczMzM2NjY2Nj4gPDYxMzI2MzM5MzQzNzM1MzkzNTYyMzgzMTMwMzgzOTYxNjE2NTYxNjYzODM4MzEzODY1NjY2NDM3MzMzNjY2NjY+IF0KL0VuY3J5cHQgNiAwIFIKPj4Kc3RhcnR4cmVmCjcyMgolJUVPRgo=";

export function encryptedPdfBytes(): Uint8Array {
  return Buffer.from(ENCRYPTED_PDF_BASE64, "base64");
}

export function fixtureDir(name: string): string {
  const dir = join(import.meta.dirname, ".fixtures", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function makePdf(
  path: string,
  pages: number,
  opts: { text?: string; sizes?: Array<[number, number]>; rotations?: number[] } = {}
): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(opts.sizes?.[i] ?? [595.28, 841.89]); // A4 default
    if (opts.rotations?.[i]) page.setRotation(degrees(opts.rotations[i]));
    page.drawText(opts.text ? `${opts.text} p${i + 1}` : `Page ${i + 1}`, {
      x: 50,
      y: 750,
      size: 24,
      font,
    });
  }
  const bytes = await doc.save();
  writeFileSync(path, bytes);
  return path;
}

/**
 * One solid-colour JPEG drawn on each of `pages` pages: page i uses
 * `colors[i]`. pdf-lib only embeds a JPEG if it is genuinely valid, so the
 * bytes come from sharp rather than a hand-rolled header.
 */
export async function makePdfWithEmbeddedJpg(
  path: string,
  colors: Array<{ r: number; g: number; b: number }>
): Promise<string> {
  const doc = await PDFDocument.create();
  for (const color of colors) {
    const jpg = await sharp({
      create: { width: 4, height: 4, channels: 3, background: color },
    })
      .jpeg()
      .toBuffer();
    const page = doc.addPage([200, 200]);
    const image = await doc.embedJpg(jpg);
    page.drawImage(image, { x: 10, y: 10, width: 100, height: 100 });
  }
  const bytes = await doc.save();
  writeFileSync(path, bytes);
  return path;
}

/** Same as above but PNG, i.e. a FlateDecode image stream (not extractable in v1). */
export async function makePdfWithEmbeddedPng(
  path: string,
  colors: Array<{ r: number; g: number; b: number }>
): Promise<string> {
  const doc = await PDFDocument.create();
  for (const color of colors) {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: color },
    })
      .png()
      .toBuffer();
    const page = doc.addPage([200, 200]);
    const image = await doc.embedPng(png);
    page.drawImage(image, { x: 10, y: 10, width: 100, height: 100 });
  }
  const bytes = await doc.save();
  writeFileSync(path, bytes);
  return path;
}

/** Solid-colour rectangle drawn on a white 200x200 page (for raster sampling). */
export async function makePdfWithRect(
  path: string,
  rects: Array<{ rgb: [number, number, number]; size?: [number, number] }>
): Promise<string> {
  const doc = await PDFDocument.create();
  for (const rect of rects) {
    const page = doc.addPage([200, 200]);
    const [w, h] = rect.size ?? [100, 100];
    page.drawRectangle({
      x: 50,
      y: 50,
      width: w,
      height: h,
      color: rgb(rect.rgb[0], rect.rgb[1], rect.rgb[2]),
    });
  }
  const bytes = await doc.save();
  writeFileSync(path, bytes);
  return path;
}
