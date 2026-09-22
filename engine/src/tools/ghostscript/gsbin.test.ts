import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { findGswin, runGs } from "./gsbin";

const scratch: string[] = [];

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pogopdf-gsbin-"));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * gswin64c.exe is staged by engine/scripts/fetch-ghostscript.ps1, exactly like
 * qpdf and soffice. Without it the spawn tests skip; the resolver tests still
 * run against their fake trees.
 */
const gsBin = findGswin();
if (!gsBin) {
  console.warn(
    "[gsbin.test] gswin64c.exe not found, skipping Ghostscript-backed tests. " +
      "Run engine/scripts/fetch-ghostscript.ps1 to enable them."
  );
}

describe.skipIf(!gsBin)("resolveGswin", () => {
  it("finds the dev-staged binary without any environment override", () => {
    expect(gsBin).toMatch(/gs-bin[\\/]bin[\\/]gswin64c\.exe$/i);
  });

  it("honours POGOPDF_GS_BIN pointing at the bin directory or the exe", () => {
    const previous = process.env.POGOPDF_GS_BIN;
    // A fake tree proves the override is consulted first: findGswin returns the
    // override's exe even though the dev-staged binary also exists.
    const fake = mkdtempSync(join(tmpdir(), "gs-override-"));
    scratch.push(fake);
    mkdirSync(join(fake, "bin"), { recursive: true });
    const fakeExe = join(fake, "bin", "gswin64c.exe");
    writeFileSync(fakeExe, "not a real binary, only the path is resolved");
    process.env.POGOPDF_GS_BIN = fake;
    try {
      expect(findGswin()).toBe(fakeExe);
      process.env.POGOPDF_GS_BIN = fakeExe;
      expect(findGswin()).toBe(fakeExe);
    } finally {
      if (previous === undefined) delete process.env.POGOPDF_GS_BIN;
      else process.env.POGOPDF_GS_BIN = previous;
    }
    expect(findGswin()).toBe(gsBin);
  });
});

describe.skipIf(!gsBin)("runGs", () => {
  it("reports the version on stdout with exit 0 and never hangs", async () => {
    const { stdout } = await runGs(["--version"], outDir());
    expect(stdout.trim()).toBe("10.08.0");
  });

  it("maps a non-zero exit to CORRUPT_PDF", async () => {
    // A missing input file makes gs exit 1 with an undefinedfilename error.
    const err = await runGs(
      ["-sDEVICE=pdfwrite", "-sOutputFile=out.pdf", join(outDir(), "nope.pdf")],
      outDir()
    ).catch((e: Error & { code?: number }) => e);
    expect(err).toMatchObject({ code: TOOL_ERROR_CODES.CORRUPT_PDF });
    expect((err as Error).message).not.toMatch(/^gs /);
  });
});
