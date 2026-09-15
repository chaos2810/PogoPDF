import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function fixtureDir(name: string): string {
  const dir = join(import.meta.dirname, ".fixtures", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function makePdf(
  path: string,
  pages: number,
  opts: { text?: string } = {}
): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595.28, 841.89]); // A4
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
