import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { registerTools } from "../registry";
import { makeDocx, makeOdt, makePptx, makeXlsx } from "../../testing/ooxml";
import { EXPORT_FILTERS, findSoffice, runOfficeConvert } from "./libreoffice";
import {
  activeConversionCount,
  killActiveConversions,
  spawnSoffice,
} from "./libreoffice";
import { runOfficeToPdf } from "./officetopdf";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

/** Scratch roots created by this file, removed in afterAll. */
const scratch: string[] = [];

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pogopdf-office-"));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Whole-document text, one string per page. */
async function pageTexts(path: string): Promise<string[]> {
  const renderer = await getPdfRenderer(path);
  try {
    const pages: string[] = [];
    for (let i = 0; i < renderer.pageCount; i++) {
      pages.push(await extractPageText(await renderer.getPage(i)));
    }
    return pages;
  } finally {
    await renderer.close();
  }
}

/**
 * soffice.exe is staged by engine/scripts/fetch-libreoffice.ps1, exactly like
 * qpdf. Without it the conversion tests skip; the resolver tests still run.
 */
const sofficeBin = findSoffice();
if (!sofficeBin) {
  console.warn(
    "[office.test] LibreOffice not found, skipping soffice-backed tests. " +
      "Run engine/scripts/fetch-libreoffice.ps1 to enable them."
  );
}

// A first soffice launch unpacks a fresh user profile, which is slower than the
// ~9s steady state measured for LibreOffice 26.2 headless. Give converts room.
const CONVERT_TIMEOUT = 120_000;

describe.skipIf(!sofficeBin)("resolveSoffice", () => {
  it("finds the dev-staged binary without any environment override", () => {
    expect(sofficeBin).toMatch(/lo-bin[\\/]program[\\/]soffice\.exe$/i);
  });

  it("honours POGOPDF_LO_BIN pointing at the program directory", () => {
    const previous = process.env.POGOPDF_LO_BIN;
    // A fake tree proves the override is consulted first: findSoffice returns the
    // override's exe even though the dev-staged binary also exists.
    const fake = mkdtempSync(join(tmpdir(), "lo-override-"));
    scratch.push(fake);
    mkdirSync(join(fake, "program"), { recursive: true });
    const fakeExe = join(fake, "program", "soffice.exe");
    writeFileSync(fakeExe, "not a real binary, only the path is resolved");
    process.env.POGOPDF_LO_BIN = fake;
    try {
      expect(findSoffice()).toBe(fakeExe);
      process.env.POGOPDF_LO_BIN = fakeExe;
      expect(findSoffice()).toBe(fakeExe);
    } finally {
      if (previous === undefined) delete process.env.POGOPDF_LO_BIN;
      else process.env.POGOPDF_LO_BIN = previous;
    }
    expect(findSoffice()).toBe(sofficeBin);
  });

  it("maps every supported extension to its export filter", () => {
    expect(EXPORT_FILTERS.docx).toBe("writer_pdf_Export");
    expect(EXPORT_FILTERS.doc).toBe("writer_pdf_Export");
    expect(EXPORT_FILTERS.rtf).toBe("writer_pdf_Export");
    expect(EXPORT_FILTERS.odt).toBe("writer_pdf_Export");
    expect(EXPORT_FILTERS.xlsx).toBe("calc_pdf_Export");
    expect(EXPORT_FILTERS.xls).toBe("calc_pdf_Export");
    expect(EXPORT_FILTERS.ods).toBe("calc_pdf_Export");
    expect(EXPORT_FILTERS.pptx).toBe("impress_pdf_Export");
    expect(EXPORT_FILTERS.ppt).toBe("impress_pdf_Export");
    expect(EXPORT_FILTERS.odp).toBe("impress_pdf_Export");
    expect(EXPORT_FILTERS.odg).toBe("draw_pdf_Export");
  });

  it("names an unsupported extension with a typed UNSUPPORTED_FORMAT", async () => {
    const err = await runOfficeConvert(join(outDir(), "x.pdf"), outDir(), "j").catch(
      (e: Error & { code?: number }) => e
    );
    expect(err).toMatchObject({ code: TOOL_ERROR_CODES.UNSUPPORTED_FORMAT });
    expect((err as Error).message).toContain(".pdf");
  });
});

describe.skipIf(!sofficeBin)("runOfficeConvert", () => {
  let dir: string;
  beforeAll(() => {
    dir = outDir();
  });

  it(
    "converts a minimal docx and the extracted text contains its paragraph",
    async () => {
      const src = await makeDocx(join(dir, "hello.docx"), "Hello Office");
      const out = await runOfficeConvert(src, dir, "docx-1");

      // LibreOffice's default output name is <basename>.pdf inside outDir.
      expect(out).toBe(join(dir, "hello.pdf"));
      expect(existsSync(out)).toBe(true);
      const doc = await PDFDocument.load(readFileSync(out));
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
      expect((await pageTexts(out)).join(" ")).toContain("Hello Office");
    },
    CONVERT_TIMEOUT
  );

  it(
    "converts a minimal xlsx and extracts the A1 cell",
    async () => {
      const src = await makeXlsx(join(dir, "cell.xlsx"), "42");
      const out = await runOfficeConvert(src, dir, "xlsx-1");
      expect(out).toBe(join(dir, "cell.pdf"));
      expect((await pageTexts(out)).join(" ")).toContain("42");
    },
    CONVERT_TIMEOUT
  );

  it(
    "converts a minimal pptx and extracts the slide title",
    async () => {
      const src = await makePptx(join(dir, "deck.pptx"), "Hello Deck");
      const out = await runOfficeConvert(src, dir, "pptx-1");
      expect(out).toBe(join(dir, "deck.pdf"));
      expect((await pageTexts(out)).join(" ")).toContain("Hello Deck");
    },
    CONVERT_TIMEOUT
  );

  it(
    "converts a minimal odt through the writer extension path",
    async () => {
      const src = await makeOdt(join(dir, "note.odt"), "Hello ODT");
      const out = await runOfficeConvert(src, dir, "odt-1");
      expect(out).toBe(join(dir, "note.pdf"));
      expect((await pageTexts(out)).join(" ")).toContain("Hello ODT");
    },
    CONVERT_TIMEOUT
  );

  it(
    "documents that a text file renamed .docx is converted anyway",
    async () => {
      // Honest behavior record: LibreOffice's Writer import filter is lenient and
      // turns the plain text into a one-paragraph document, so the conversion
      // succeeds. The wrapper must not turn that into an error.
      const src = join(dir, "fake.docx");
      writeFileSync(src, "this is plain text, not really a docx");
      const out = await runOfficeConvert(src, dir, "fake-1");
      expect(out).toBe(join(dir, "fake.pdf"));
      expect(existsSync(out)).toBe(true);
      expect((await pageTexts(out)).join(" ")).toContain("plain text");
    },
    CONVERT_TIMEOUT
  );

  it(
    "gives two runs distinct profile directories so they never share a lock",
    async () => {
      const src = await makeDocx(join(dir, "profiles.docx"), "Profile");
      const first = await runOfficeConvert(src, dir, "profile-a");
      const second = await runOfficeConvert(src, dir, "profile-b");
      expect(first).toBe(second);
      const dirs = readdirSync(dir).filter((e) => e.startsWith("lo-profile-"));
      expect(dirs).toContain("lo-profile-profile-a");
      expect(dirs).toContain("lo-profile-profile-b");
      expect(dirs.length).toBeGreaterThanOrEqual(2);
    },
    CONVERT_TIMEOUT
  );

  it(
    "output is present when the conversion call resolves",
    async () => {
      // Empirical finding for the report: modern headless --convert-to blocks
      // until the PDF is written. Time the whole call, then check the file the
      // instant the promise resolves, before any poll fallback can run. The
      // elapsed total is recorded as evidence, not asserted tightly (a first
      // launch unpacks a profile and is legitimately slow).
      const src = await makeDocx(join(dir, "blocking.docx"), "Blocking");
      const t0 = Date.now();
      const out = await runOfficeConvert(src, dir, "blocking-1");
      const elapsed = Date.now() - t0;
      expect(existsSync(out)).toBe(true);
      console.info(`[office.test] blocking-1 convert resolved in ${elapsed} ms; output present`);
    },
    CONVERT_TIMEOUT
  );
});

describe.skipIf(!sofficeBin)("runOfficeToPdf", () => {
  it(
    "returns the output PDF path for the tool registry",
    async () => {
      const dir = outDir();
      const src = await makeDocx(join(dir, "wired.docx"), "Wired Tool");
      const out = await runOfficeToPdf({ filePath: src }, ctx, dir);
      expect(basename(out)).toBe("wired.pdf");
      expect((await pageTexts(out)).join(" ")).toContain("Wired Tool");
    },
    CONVERT_TIMEOUT
  );

  it("maps a missing input file to CORRUPT_PDF", async () => {
    await expect(
      runOfficeToPdf({ filePath: join(outDir(), "nope.docx") }, ctx, outDir())
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CORRUPT_PDF });
  });

  it("throws CANCELLED when cancelled before the spawn", async () => {
    const dir = outDir();
    const src = await makeDocx(join(dir, "cancel.docx"), "Cancel");
    await expect(
      runOfficeToPdf({ filePath: src }, { ...ctx, cancelled: () => true }, dir)
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.CANCELLED });
  });
});

describe("office registry", () => {
  it("registers officeToPdf", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("officeToPdf")).toBe(true);
  });
});

describe("soffice child tracking", () => {
  it("tracks a live child and kills it on the exit hook", async () => {
    // A short-lived node process stands in for soffice: the point is that the
    // module registers the child while it runs and reaps it on process exit.
    const before = activeConversionCount();
    const exited = spawnSoffice(
      process.execPath,
      ["-e", "setTimeout(() => {}, 5000)"],
      process.cwd()
    );
    expect(activeConversionCount()).toBe(before + 1);

    killActiveConversions();
    expect(activeConversionCount()).toBe(0);
    // The killed child closes (Windows reports a null code for signal kills)
    // rather than hanging the promise.
    const result = await exited;
    expect(result.code === null || typeof result.code === "number").toBe(true);
  });

  it("drops a child from tracking when it closes on its own", async () => {
    const before = activeConversionCount();
    await spawnSoffice(process.execPath, ["-e", "0"], process.cwd());
    expect(activeConversionCount()).toBe(before);
  });
});
