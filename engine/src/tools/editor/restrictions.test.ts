import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureDir, makePdf } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { registerTools } from "../registry";
import { findQpdf, runQpdf } from "../secure/qpdfbin";
import { runProtect } from "../secure/protect";
import { buildRemoveRestrictionsArgs, runRemoveRestrictions } from "./restrictions";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-restrictions-"));
}

const qpdfBin = findQpdf();
if (!qpdfBin) {
  console.warn(
    "[restrictions.test] qpdf not found - skipping qpdf-backed tests. " +
      "Run engine/scripts/fetch-qpdf.ps1 to enable them."
  );
}

/** Owner-restricted fixture: empty user password, copying disallowed. */
async function restricted(src: string, ownerPassword: string): Promise<string> {
  return runProtect(
    { filePath: src, ownerPassword, allowCopying: false, allowPrinting: true },
    ctx,
    outDir()
  );
}

/** Owner-locked fixture that also needs a user password to open. */
async function userLocked(src: string, userPassword: string, ownerPassword: string): Promise<string> {
  return runProtect({ filePath: src, userPassword, ownerPassword }, ctx, outDir());
}

describe.skipIf(!qpdfBin)("runRemoveRestrictions", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("editor-restrictions");
  });

  it("frees an owner-restricted file without a password", async () => {
    const src = await makePdf(join(dir, "owner-src.pdf"), 2);
    const enc = await restricted(src, "ownerpw");

    // Precondition: the fixture really carries the restriction.
    const { stdout: before } = await runQpdf(["--show-encryption", "--", enc], outDir());
    expect(before).toMatch(/extract for any purpose: not allowed/);

    const out = await runRemoveRestrictions({ filePath: enc }, ctx, outDir());
    expect(out.endsWith("unrestricted.pdf")).toBe(true);

    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(2);

    const { stdout: after } = await runQpdf(["--show-encryption", "--", out], outDir());
    expect(after).toMatch(/File is not encrypted/);
  });

  it("unlocks a user-password file when the password is supplied", async () => {
    const src = await makePdf(join(dir, "user-src.pdf"), 3);
    const enc = await userLocked(src, "secret", "owner");
    const out = await runRemoveRestrictions(
      { filePath: enc, password: "secret" },
      ctx,
      outDir()
    );

    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(3);
    const renderer = await getPdfRenderer(out);
    try {
      expect(await extractPageText(await renderer.getPage(0))).toBe("Page 1");
    } finally {
      await renderer.close();
    }
  });

  it("reports ENCRYPTED_PDF for a user-password file with no password", async () => {
    const src = await makePdf(join(dir, "needs-pw.pdf"), 1);
    const enc = await userLocked(src, "secret", "owner");
    await expect(
      runRemoveRestrictions({ filePath: enc }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
  });

  it("is a passthrough for an unencrypted file", async () => {
    const src = await makePdf(join(dir, "plain.pdf"), 2);
    const out = await runRemoveRestrictions({ filePath: src }, ctx, outDir());
    expect((await PDFDocument.load(readFileSync(out))).getPageCount()).toBe(2);
  });

  it("maps a missing file to CORRUPT_PDF", async () => {
    await expect(
      runRemoveRestrictions({ filePath: join(dir, "nope.pdf") }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("throws CANCELLED when cancelled before doing any work", async () => {
    const src = await makePdf(join(dir, "cancel.pdf"), 1);
    await expect(
      runRemoveRestrictions({ filePath: src }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("omits any password argument when no password is given", () => {
    expect(buildRemoveRestrictionsArgs(undefined, "in.pdf", "out.pdf")).toEqual([
      "--decrypt",
      "--",
      "in.pdf",
      "out.pdf",
    ]);
  });

  it("keeps the password off the qpdf command line when given", () => {
    const args = buildRemoveRestrictionsArgs("pw.txt", "in.pdf", "out.pdf");
    expect(args).toEqual(["--password-file=pw.txt", "--decrypt", "--", "in.pdf", "out.pdf"]);
    for (const arg of args) expect(arg).not.toContain("secret");
  });

  it("deletes the password file after a successful run", async () => {
    const src = await makePdf(join(dir, "cleanup.pdf"), 2);
    const enc = await userLocked(src, "pw", "o");
    const jobDir = outDir();
    const out = await runRemoveRestrictions({ filePath: enc, password: "pw" }, ctx, jobDir);
    expect(existsSync(out)).toBe(true);
    expect(existsSync(join(jobDir, "restrictions-password.txt"))).toBe(false);
  });

  it("deletes the password file even when the password is rejected", async () => {
    const src = await makePdf(join(dir, "cleanup-fail.pdf"), 1);
    const enc = await userLocked(src, "right", "o");
    const jobDir = outDir();
    await expect(
      runRemoveRestrictions({ filePath: enc, password: "wrong" }, ctx, jobDir)
    ).rejects.toMatchObject({ code: -32002 });
    const leftovers = readdirSync(jobDir).filter((f) => f.includes("password"));
    expect(leftovers).toEqual([]);
  });
});

describe("editor restrictions registry", () => {
  it("registers removeRestrictions", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("removeRestrictions")).toBe(true);
  });
});
