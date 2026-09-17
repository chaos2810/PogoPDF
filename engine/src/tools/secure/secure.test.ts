import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fixtureDir, makePdf } from "../../testing/fixtures";
import { getPdfRenderer } from "../../render/renderpdf";
import { extractPageText } from "../../render/textextract";
import { registerTools } from "../registry";
import { findQpdf, runQpdf } from "./qpdfbin";
import { buildEncryptArgs, buildEncryptJob, runProtect } from "./protect";
import { buildDecryptArgs, runUnlock } from "./unlock";
import { runFlatten } from "./flatten";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-secure-"));
}

/** qpdf 11's flatten flag, verified against `qpdf --help=all` on 11.10.1. */
const qpdfBin = findQpdf();
if (!qpdfBin) {
  console.warn(
    "[secure.test] qpdf not found — skipping qpdf-backed tests. " +
      "Run engine/scripts/fetch-qpdf.ps1 to enable them."
  );
}

/** Owner-locked fixture with a user password: pdf-lib cannot open it silently. */
async function locked(
  src: string,
  opts: { userPassword?: string; ownerPassword: string; allowPrinting?: boolean; allowCopying?: boolean }
): Promise<string> {
  return runProtect(
    {
      filePath: src,
      ownerPassword: opts.ownerPassword,
      ...(opts.userPassword !== undefined ? { userPassword: opts.userPassword } : {}),
      ...(opts.allowPrinting !== undefined ? { allowPrinting: opts.allowPrinting } : {}),
      ...(opts.allowCopying !== undefined ? { allowCopying: opts.allowCopying } : {}),
    },
    ctx,
    outDir()
  );
}

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

/** One page with a single text form field named "name" holding "Hello". */
async function formPdf(path: string): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const field = doc.getForm().createTextField("name");
  field.setText("Hello");
  field.addToPage(page, { x: 50, y: 100, width: 150, height: 20 });
  writeFileSync(path, await doc.save());
  return path;
}

describe.skipIf(!qpdfBin)("qpdf binary", () => {
  it("reports a version", async () => {
    const { stdout } = await runQpdf(["--version"], outDir());
    expect(stdout).toMatch(/^qpdf version 11\./);
  });
});

describe.skipIf(!qpdfBin)("runProtect", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("secure-protect");
  });

  it("writes protected.pdf and blocks a passwordless pdf-lib load", async () => {
    const src = await makePdf(join(dir, "src.pdf"), 2);
    const out = await locked(src, { userPassword: "userpw", ownerPassword: "ownerpw" });
    expect(out.endsWith("protected.pdf")).toBe(true);
    expect(existsSync(out)).toBe(true);
    await expect(PDFDocument.load(readFileSync(out))).rejects.toThrow(/encrypted/i);
  });

  it("maps allowPrinting/allowCopying to qpdf print/extract flags", async () => {
    const src = await makePdf(join(dir, "flags.pdf"), 1);
    const restricted = await locked(src, {
      userPassword: "u",
      ownerPassword: "o",
      allowPrinting: false,
      allowCopying: false,
    });
    const { stdout: restrictedFlags } = await runQpdf(
      ["--password=u", "--show-encryption", "--", restricted],
      outDir()
    );
    expect(restrictedFlags).toMatch(/print low resolution: not allowed/);
    expect(restrictedFlags).toMatch(/print high resolution: not allowed/);
    expect(restrictedFlags).toMatch(/extract for any purpose: not allowed/);

    const permissive = await locked(src, {
      userPassword: "u",
      ownerPassword: "o",
      allowPrinting: true,
      allowCopying: true,
    });
    const { stdout: permissiveFlags } = await runQpdf(
      ["--password=u", "--show-encryption", "--", permissive],
      outDir()
    );
    expect(permissiveFlags).toMatch(/print high resolution: allowed/);
    expect(permissiveFlags).toMatch(/extract for any purpose: allowed/);
  });

  it("uses AES-256", async () => {
    const src = await makePdf(join(dir, "aes.pdf"), 1);
    const out = await locked(src, { userPassword: "u", ownerPassword: "o" });
    const { stdout } = await runQpdf(["--password=u", "--show-encryption", "--", out], outDir());
    expect(stdout).toMatch(/file encryption method: AESv3/);
  });

  it("round-trips: unlock restores a loadable document with intact content", async () => {
    const src = await makePdf(join(dir, "roundtrip.pdf"), 2);
    const enc = await locked(src, { userPassword: "secret", ownerPassword: "owner" });
    const dec = await runUnlock({ filePath: enc, password: "secret" }, ctx, outDir());

    const doc = await PDFDocument.load(readFileSync(dec));
    expect(doc.getPageCount()).toBe(2);
    expect(await pageTexts(dec)).toEqual(["Page 1", "Page 2"]);
  });

  it("with userPassword omitted the output opens without a password but keeps restrictions", async () => {
    const src = await makePdf(join(dir, "owner-only.pdf"), 1);
    const out = await locked(src, {
      ownerPassword: "owneronly",
      allowCopying: false,
    });

    const { stdout } = await runQpdf(["--show-encryption", "--", out], outDir());
    expect(stdout).toMatch(/^User password = $/m);
    expect(stdout).toMatch(/Supplied password is user password/);
    expect(stdout).toMatch(/extract for any purpose: not allowed/);

    // pdf-lib rejects every encrypted document outright, even an empty-user one,
    // so the "opens without a password" claim is probed with a real reader.
    // pdf.js opens it passwordlessly and reads the page; a user-password file
    // would fail here with "No password given".
    const renderer = await getPdfRenderer(out);
    try {
      expect(renderer.pageCount).toBe(1);
      expect(await extractPageText(await renderer.getPage(0))).toBe("Page 1");
    } finally {
      await renderer.close();
    }

    const withUserPw = await locked(src, { userPassword: "pw", ownerPassword: "o" });
    await expect(getPdfRenderer(withUserPw)).rejects.toThrow(/password/i);
  });

  it("maps a missing file to CORRUPT_PDF", async () => {
    await expect(
      runProtect({ filePath: join(dir, "nope.pdf"), ownerPassword: "o" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("throws CANCELLED when cancelled before doing any work", async () => {
    const src = await makePdf(join(dir, "cancel.pdf"), 1);
    await expect(
      runProtect({ filePath: src, ownerPassword: "o" }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("maps protecting an encrypted source that needs its password to ENCRYPTED_PDF", async () => {
    // qpdf must decrypt the input before re-encrypting it. Without the source
    // password it reports "invalid password" (exit 2), which is an encrypted
    // input, not a corrupt one — documented behavior, not an oversight.
    const src = await makePdf(join(dir, "enc-src.pdf"), 1);
    const enc = await locked(src, { userPassword: "srcpw", ownerPassword: "o" });
    await expect(
      runProtect({ filePath: enc, ownerPassword: "newowner" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
  });

  it("round-trips a password containing spaces, quotes and symbols", async () => {
    const src = await makePdf(join(dir, "special.pdf"), 1);
    const special = 'p@ss w"ord\\$;x';
    const out = await runProtect(
      { filePath: src, userPassword: special, ownerPassword: "owner#2'quote" },
      ctx,
      outDir()
    );
    const pwFile = join(outDir(), "special-pw.txt");
    writeFileSync(pwFile, special);
    const { stdout } = await runQpdf(
      [`--password-file=${pwFile}`, "--show-encryption", "--", out],
      outDir()
    );
    expect(stdout).toContain("Supplied password is user password");
  });

  it("keeps both passwords out of the qpdf command line", async () => {
    // The argv is a single --job-json-file reference; the secrets live in that
    // file. Assert on the pure builders so this cannot silently regress.
    const job = buildEncryptJob(
      { filePath: "in.pdf", userPassword: "argp", ownerPassword: "argp-owner", allowPrinting: true, allowCopying: false },
      "out.pdf"
    ) as { encrypt: { userPassword: string; ownerPassword: string } };
    expect(job.encrypt.userPassword).toBe("argp");
    expect(job.encrypt.ownerPassword).toBe("argp-owner");

    const args = buildEncryptArgs("job.json");
    expect(args).toEqual(["--job-json-file=job.json"]);
    for (const arg of args) {
      expect(arg).not.toContain("argp");
      expect(arg).not.toContain("argp-owner");
    }
  });

  it("deletes the job JSON (with the passwords) after a successful run", async () => {
    const src = await makePdf(join(dir, "cleanup.pdf"), 1);
    const out = await runProtect(
      { filePath: src, userPassword: "u", ownerPassword: "o" },
      ctx,
      outDir()
    );
    expect(existsSync(out)).toBe(true);
    expect(existsSync(join(dirname(out), "protect-job.json"))).toBe(false);
  });
});

describe.skipIf(!qpdfBin)("runUnlock", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("secure-unlock");
  });

  it("writes unlocked.pdf and removes encryption", async () => {
    const src = await makePdf(join(dir, "src.pdf"), 3);
    const enc = await locked(src, { userPassword: "pw", ownerPassword: "opw" });
    const out = await runUnlock({ filePath: enc, password: "pw" }, ctx, outDir());

    expect(out.endsWith("unlocked.pdf")).toBe(true);
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(3);
    const { stdout } = await runQpdf(["--show-encryption", "--", out], outDir());
    expect(stdout).toMatch(/File is not encrypted/);
  });

  it("rejects a wrong password with a clean ENCRYPTED_PDF error", async () => {
    const src = await makePdf(join(dir, "wrong.pdf"), 1);
    const enc = await locked(src, { userPassword: "right", ownerPassword: "o" });
    const err = await runUnlock({ filePath: enc, password: "wrong" }, ctx, outDir()).catch(
      (e: Error & { code?: number }) => e
    );
    expect(err).toMatchObject({ code: -32002 });
    expect((err as Error).message).not.toMatch(/qpdf: /);
  });

  it("is a no-op passthrough for a non-encrypted input", async () => {
    const src = await makePdf(join(dir, "plain.pdf"), 2);
    const out = await runUnlock({ filePath: src, password: "anything" }, ctx, outDir());
    const doc = await PDFDocument.load(readFileSync(out));
    expect(doc.getPageCount()).toBe(2);
  });

  it("maps a missing file to CORRUPT_PDF", async () => {
    await expect(
      runUnlock({ filePath: join(dir, "nope.pdf"), password: "x" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("maps a corrupt file whose name contains 'password' to CORRUPT_PDF", async () => {
    // qpdf's stderr echoes the input path, so a bare /password/i matcher read
    // this name as an encrypted file. Only qpdf's own wording may match.
    const bad = join(dir, "my-password-reset.pdf");
    writeFileSync(bad, Buffer.from("not a pdf, no password here"));
    const err = await runUnlock({ filePath: bad, password: "x" }, ctx, outDir()).catch(
      (e: Error & { code?: number }) => e
    );
    expect(err).toMatchObject({ code: -32003 });
    expect((err as Error).message).not.toMatch(/encrypted/i);
  });

  it("throws CANCELLED when cancelled before doing any work", async () => {
    const src = await makePdf(join(dir, "cancel.pdf"), 1);
    await expect(
      runUnlock({ filePath: src, password: "x" }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("keeps the password out of the qpdf command line", () => {
    const args = buildDecryptArgs("pw.txt", "in.pdf", "out.pdf");
    expect(args).toEqual(["--password-file=pw.txt", "--decrypt", "--", "in.pdf", "out.pdf"]);
    for (const arg of args) expect(arg).not.toContain("secret");
  });

  it("deletes the password file after a successful run", async () => {
    const src = await makePdf(join(dir, "cleanup.pdf"), 2);
    const enc = await locked(src, { userPassword: "pw", ownerPassword: "o" });
    const out = await runUnlock({ filePath: enc, password: "pw" }, ctx, outDir());
    expect(existsSync(out)).toBe(true);
    expect(existsSync(join(dirname(out), "unlock-password.txt"))).toBe(false);
  });

  it("deletes the password file even when the password is rejected", async () => {
    const src = await makePdf(join(dir, "cleanup-fail.pdf"), 1);
    const enc = await locked(src, { userPassword: "right", ownerPassword: "o" });
    const jobDir = outDir();
    await expect(
      runUnlock({ filePath: enc, password: "wrong" }, ctx, jobDir)
    ).rejects.toMatchObject({ code: -32002 });
    const leftovers = readdirSync(jobDir).filter((f) => f.includes("password"));
    expect(leftovers).toEqual([]);
  });
});

describe.skipIf(!qpdfBin)("runFlatten", () => {
  let dir: string;
  beforeAll(() => {
    dir = fixtureDir("secure-flatten");
  });

  it("removes form fields and their page annotations", async () => {
    const src = await formPdf(join(dir, "form.pdf"));
    const before = await PDFDocument.load(readFileSync(src));
    expect(before.getForm().getFields()).toHaveLength(1);

    const out = await runFlatten({ filePath: src }, ctx, outDir());
    expect(out.endsWith("flattened.pdf")).toBe(true);

    const after = await PDFDocument.load(readFileSync(out));
    expect(after.getForm().getFields()).toHaveLength(0);
    expect(after.getPage(0).node.Annots?.()).toBeUndefined();
  });

  it("keeps the visual content (the page still renders non-blank)", async () => {
    const src = await formPdf(join(dir, "visual.pdf"));
    const out = await runFlatten({ filePath: src }, ctx, outDir());
    const renderer = await getPdfRenderer(out);
    try {
      const canvas = await renderer.renderPage(0, 150);
      const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++;
      expect(dark).toBeGreaterThan(0);
    } finally {
      await renderer.close();
    }
  });

  it("flattens a document without any form or annotations", async () => {
    const src = await makePdf(join(dir, "plain.pdf"), 1);
    const out = await runFlatten({ filePath: src }, ctx, outDir());
    expect((await PDFDocument.load(readFileSync(out))).getPageCount()).toBe(1);
  });

  it("maps an encrypted source to ENCRYPTED_PDF", async () => {
    const src = await makePdf(join(dir, "enc-src.pdf"), 1);
    const enc = await locked(src, { userPassword: "pw", ownerPassword: "o" });
    await expect(runFlatten({ filePath: enc }, ctx, outDir())).rejects.toMatchObject({
      code: -32002,
    });
  });

  it("maps a missing file to CORRUPT_PDF", async () => {
    await expect(runFlatten({ filePath: join(dir, "nope.pdf") }, ctx, outDir())).rejects.toMatchObject(
      { code: -32003 }
    );
  });

  it("throws CANCELLED when cancelled before doing any work", async () => {
    const src = await formPdf(join(dir, "cancel.pdf"));
    await expect(
      runFlatten({ filePath: src }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("secure registry", () => {
  it("registers protect, unlock and flatten", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("protect")).toBe(true);
    expect(tools.has("unlock")).toBe(true);
    expect(tools.has("flatten")).toBe(true);
  });
});
