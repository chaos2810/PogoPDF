import { describe, it, expect, beforeAll } from "vitest";
import { runMerge } from "./merge";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureDir, makePdf } from "../../testing/fixtures";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

describe("runMerge", () => {
  let dir: string;
  beforeAll(async () => {
    dir = fixtureDir("merge");
    await makePdf(join(dir, "a.pdf"), 2);
    await makePdf(join(dir, "b.pdf"), 3);
  });

  it("merges page counts in order", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
    const out = await runMerge(
      { filePaths: [join(dir, "a.pdf"), join(dir, "b.pdf")] },
      ctx,
      outDir
    );
    const doc = await PDFDocument.load(await readFile(out));
    expect(doc.getPageCount()).toBe(5);
  });

  it("emits progress per file", async () => {
    const events: number[] = [];
    const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
    await runMerge(
      { filePaths: [join(dir, "a.pdf"), join(dir, "b.pdf")] },
      { ...ctx, notifyProgress: (p) => events.push(p.percent) },
      outDir
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]).toBe(100);
  });

  it("throws CANCELLED when ctx says cancelled after first file", async () => {
    let cancelled = false;
    const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
    const cancelCtx = {
      ...ctx,
      cancelled: () => cancelled,
      notifyProgress: () => {
        cancelled = true;
      },
    };
    await expect(
      runMerge({ filePaths: [join(dir, "a.pdf"), join(dir, "b.pdf")] }, cancelCtx, outDir)
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("throws for missing file", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "pogopdf-test-"));
    await expect(
      runMerge(
        { filePaths: [join(dir, "missing.pdf"), join(dir, "b.pdf")] },
        ctx,
        outDir
      )
    ).rejects.toMatchObject({ code: -32003 });
  });
});
