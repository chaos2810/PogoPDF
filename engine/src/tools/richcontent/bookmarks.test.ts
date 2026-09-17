import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { makePdf } from "../../testing/fixtures";
import {
  readBookmarks,
  runEditBookmarks,
  runToc,
  runViewBookmarks,
} from "./bookmarks";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

let dir: string;
let threePage: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pogopdf-bookmarks-"));
  threePage = await makePdf(join(dir, "three.pdf"), 3);
});

const TREE = [
  { title: "Intro", page: 1, children: [] },
  {
    title: "Methods",
    page: 2,
    children: [
      { title: "Setup", page: 2, children: [] },
      { title: "Analysis", page: 3, children: [] },
    ],
  },
  { title: "Results", page: 3, children: [] },
];

async function fixtureWithOutline(outDir: string): Promise<string> {
  await makePdf(join(outDir, "src.pdf"), 3);
  const edited = await runEditBookmarks(
    { filePath: join(outDir, "src.pdf"), bookmarks: TREE },
    ctx,
    outDir
  );
  return edited;
}

describe("bookmark view and edit", () => {
  it("edit then view roundtrips the tree with 1-based pages", async () => {
    const work = mkdtempSync(join(tmpdir(), "pogopdf-bm-"));
    const path = await fixtureWithOutline(work);
    const result = (await runViewBookmarks({ filePath: path }, ctx, work)) as {
      bookmarks: typeof TREE;
    };
    expect(result.bookmarks).toHaveLength(3);
    expect(result.bookmarks[0]).toMatchObject({ title: "Intro", page: 1 });
    expect(result.bookmarks[1].children).toHaveLength(2);
    expect(result.bookmarks[1].children[0]).toMatchObject({
      title: "Setup",
      page: 2,
    });
    expect(result.bookmarks[1].children[1]).toMatchObject({
      title: "Analysis",
      page: 3,
    });
    expect(result.bookmarks[2]).toMatchObject({ title: "Results", page: 3 });
  });

  it("view on a PDF with no outline reads an empty tree", async () => {
    const result = (await runViewBookmarks({ filePath: threePage }, ctx, dir)) as {
      bookmarks: unknown[];
    };
    expect(result.bookmarks).toEqual([]);
  });

  it("roundtrips a CJK bookmark title through PDFHexString", async () => {
    const work = mkdtempSync(join(tmpdir(), "pogopdf-bm-"));
    await makePdf(join(work, "cjk.pdf"), 1);
    const path = await runEditBookmarks(
      {
        filePath: join(work, "cjk.pdf"),
        bookmarks: [{ title: "第一章 緒論", page: 1, children: [] }],
      },
      ctx,
      work
    );
    const result = (await runViewBookmarks({ filePath: path }, ctx, work)) as {
      bookmarks: { title: string }[];
    };
    expect(result.bookmarks[0].title).toBe("第一章 緒論");
  });

  it("clamps an out-of-range bookmark page to the last page", async () => {
    const work = mkdtempSync(join(tmpdir(), "pogopdf-bm-"));
    await makePdf(join(work, "one.pdf"), 1);
    const doc = await PDFDocument.load(await readFile(join(work, "one.pdf")));
    const before = doc.getPageCount();
    await expect(
      runEditBookmarks(
        {
          filePath: join(work, "one.pdf"),
          bookmarks: [{ title: "Beyond", page: before + 5, children: [] }],
        },
        ctx,
        work
      )
    ).resolves.toBeTruthy();
    // Out-of-range pages clamp to the last page: view reads the written tree.
    const written = await runViewBookmarks(
      { filePath: join(work, "bookmarks.pdf") },
      ctx,
      work
    );
    expect((written as { bookmarks: { page: number }[] }).bookmarks[0].page).toBe(1);
  });

  it("throws ENCRYPTED_PDF for an encrypted file", async () => {
    const { encryptedPdfBytes } = await import("../../testing/fixtures");
    const work = mkdtempSync(join(tmpdir(), "pogopdf-bm-"));
    const encPath = join(work, "enc.pdf");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(encPath, encryptedPdfBytes());
    await expect(runViewBookmarks({ filePath: encPath }, ctx, work)).rejects.toMatchObject(
      { code: -32002 }
    );
  });

  it("readBookmarks returns [] when the catalog has no outlines", async () => {
    const doc = await PDFDocument.load(await readFile(threePage));
    expect(readBookmarks(doc)).toEqual([]);
  });
});

describe("table of contents", () => {
  it("inserts a TOC at the beginning containing titles and numbers", async () => {
    const work = mkdtempSync(join(tmpdir(), "pogopdf-toc-"));
    const src = await fixtureWithOutline(work);
    const out = await runToc({ filePath: src, position: "beginning" }, ctx, work);

    const renderer = await getPdfRenderer(out);
    expect(renderer.pageCount).toBe(4);
    const tocText = await extractPageText(await renderer.getPage(0));
    expect(tocText).toContain("Table of Contents");
    expect(tocText).toContain("Intro");
    expect(tocText).toContain("Methods");
    expect(tocText).toContain("Setup");
    expect(tocText).toContain("Results");
    // The rendered number is the bookmark's stored (semantic) page number.
    expect(tocText).toContain("1");
    expect(tocText).toContain("3");
    await renderer.close();
  });

  it("after-cover inserts the TOC as output page 2", async () => {
    const work = mkdtempSync(join(tmpdir(), "pogopdf-toc-"));
    const src = await fixtureWithOutline(work);
    const out = await runToc(
      { filePath: src, position: "after-cover", title: "Contents" },
      ctx,
      work
    );
    const renderer = await getPdfRenderer(out);
    const page1 = await extractPageText(await renderer.getPage(0));
    const page2 = await extractPageText(await renderer.getPage(1));
    expect(page2).toContain("Contents");
    expect(page2).toContain("Intro");
    expect(page1).not.toContain("Contents");
    await renderer.close();
  });

  it("throws INVALID_INPUT when no outline exists", async () => {
    const work = mkdtempSync(join(tmpdir(), "pogopdf-toc-"));
    await expect(
      runToc({ filePath: threePage, position: "beginning" }, ctx, work)
    ).rejects.toMatchObject({ code: -32001 });
  });

  it("paginates a long outline into multiple TOC pages", async () => {
    const work = mkdtempSync(join(tmpdir(), "pogopdf-toc-"));
    await makePdf(join(work, "long.pdf"), 3);
    const many = Array.from({ length: 40 }, (_, i) => ({
      title: `Chapter ${i + 1}`,
      page: (i % 3) + 1,
      children: [],
    }));
    const src = await runEditBookmarks(
      { filePath: join(work, "long.pdf"), bookmarks: many },
      ctx,
      work
    );
    const out = await runToc({ filePath: src, position: "beginning" }, ctx, work);
    const renderer = await getPdfRenderer(out);
    expect(renderer.pageCount).toBe(3 + 2);
    const tocPage1 = await extractPageText(await renderer.getPage(0));
    const tocPage2 = await extractPageText(await renderer.getPage(1));
    // Reading order preserved across the paginated TOC: chapter 1 on the
    // first TOC page, chapter 40 on the last.
    expect(tocPage1).toContain("Chapter 1");
    expect(tocPage2).toContain("Chapter 40");
    await renderer.close();
  });

  it("throws typed INVALID_INPUT for a non-Latin bookmark title", async () => {
    const work = mkdtempSync(join(tmpdir(), "pogopdf-toc-"));
    await makePdf(join(work, "cjk.pdf"), 1);
    const src = await runEditBookmarks(
      {
        filePath: join(work, "cjk.pdf"),
        bookmarks: [{ title: "第一章", page: 1, children: [] }],
      },
      ctx,
      work
    );
    await expect(
      runToc({ filePath: src, position: "beginning" }, ctx, work)
    ).rejects.toMatchObject({ code: -32001 });
  });
});