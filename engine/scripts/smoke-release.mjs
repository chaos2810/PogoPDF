// Smoke-test a staged release engine: ping, a pdfToImages job, an OCR job, a
// protect -> unlock roundtrip backed by the staged qpdf, and a sign -> validate
// roundtrip (the signing stack is bundled, so no external tool gates it). When
// LibreOffice is staged (deps/lo/program/soffice.exe) an office conversion case
// runs, and when Ghostscript is staged (deps/gs/bin/gswin64c.exe) a pdfToPdfA
// case runs. The timestamp tool is not covered (it needs a live network TSA).
//
// Usage: node engine/scripts/smoke-release.mjs <engine.exe> <fixture.pdf>
// The engine is run against the sibling engine-deps-<id>/ directory (the same
// layout src-tauri produces), so this exercises the SEA bootstrap, the native
// module resolution, the release qpdf layout (deps/qpdf/), the staged
// LibreOffice layout (deps/lo/) and the staged Ghostscript layout (deps/gs/)
// without building the whole app.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import forge from "node-forge";
import { PDFDocument, PDFName } from "pdf-lib";

const [exe, fixture] = process.argv.slice(2);
if (!exe || !fixture) {
  console.error("usage: node smoke-release.mjs <engine.exe> <fixture.pdf>");
  process.exit(2);
}

const dir = dirname(exe);
// Derive the deps dir from the exe basename (engine-<id>.exe -> engine-deps-<id>):
// the same rule the SEA bootstrap uses, so the smoke test can never pair a stale
// engine with a fresh deps tree (or vice versa) that happens to sit beside it.
const exeName = basename(exe);
const idMatch = /^engine-(.+)\.exe$/.exec(exeName);
if (!idMatch) {
  console.error(`engine exe must be named engine-<id>.exe (got ${exeName})`);
  process.exit(2);
}
const depsName = `engine-deps-${idMatch[1]}`;
const deps = join(dir, depsName);
if (!statSync(deps, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`missing deps directory ${deps}`);
  process.exit(2);
}
const qpdfExe = join(deps, "qpdf", "qpdf.exe");
if (!statSync(qpdfExe, { throwIfNoEntry: false })?.isFile()) {
  console.error(`missing staged qpdf at ${qpdfExe}`);
  process.exit(2);
}

// LibreOffice is staged at deps/lo/ (build-release.ps1) and resolved by
// resolveSoffice() from the release spawn cwd. Its case is optional: a release
// built without engine/lo-bin is still smoke-testable for everything else.
const sofficeExe = join(deps, "lo", "program", "soffice.exe");
const hasSoffice = statSync(sofficeExe, { throwIfNoEntry: false })?.isFile() === true;
if (!hasSoffice) {
  console.warn(`[smoke] no staged LibreOffice at ${sofficeExe}; skipping the office conversion case.`);
}

// Ghostscript is staged at deps/gs/ (build-release.ps1) and resolved by
// resolveGswin() from the release spawn cwd. Its case is optional the same way.
const gsExe = join(deps, "gs", "bin", "gswin64c.exe");
const hasGs = statSync(gsExe, { throwIfNoEntry: false })?.isFile() === true;
if (!hasGs) {
  console.warn(`[smoke] no staged Ghostscript at ${gsExe}; skipping the pdfToPdfA case.`);
}

/**
 * A self-signed certificate and matching PKCS#12 bundle, generated here with
 * node-forge so no binary certificate is checked in (same shape as the engine
 * tests). `p12` is the DER bundle.
 */
function makeSelfSignedP12(passphrase, commonName) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 1);
  cert.validity.notAfter = notAfter;
  const attrs = [
    { name: "commonName", value: commonName },
    { name: "organizationName", value: "PogoPDF" },
    { shortName: "C", value: "TW" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: "3des",
  });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");
}

// Load the repo's OOXML fixture builder (TypeScript) through tsx so the docx
// crafted here is byte-for-byte the one the engine tests use.
async function loadDocxBuilder() {
  const { register } = await import("tsx/esm/api");
  const unregister = register();
  try {
    const mod = await import("../src/testing/ooxml.ts");
    return { makeDocx: mod.makeDocx, unregister };
  } catch (e) {
    if (typeof unregister === "function") unregister();
    throw e;
  }
}

const child = spawn(exe, [], { cwd: deps, stdio: ["pipe", "pipe", "pipe"] });
let out = "";
let err = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (err += d));

// A dead engine (bad spawn, crash on startup, immediate exit) must fail in
// milliseconds rather than waiting for the full 120s timeout: reject every
// pending request the moment the process exits or errors.
function failPending(reason) {
  for (const { reject } of pending.values()) reject(reason);
  pending.clear();
}
child.on("exit", (code, signal) => {
  failPending(new Error(`engine exited before responding (code ${code}, signal ${signal})`));
});
child.on("error", (e) => failPending(e));

const timer = setTimeout(() => {
  console.error("TIMEOUT\n" + out + "\n" + err);
  child.kill();
  process.exit(1);
}, 120000);

// Line-oriented JSON-RPC client: each request gets an id, and the matching
// response is resolved from the engine's stdout stream.
const pending = new Map();
let nextId = 1;
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = pending.get(msg.id);
    if (entry) {
      pending.delete(msg.id);
      entry.resolve(msg);
    }
  }
});

const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, {
      resolve: (msg) => {
        if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      },
      reject,
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

const uuid = (n) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;

// Office conversion scratch (the crafted docx + its output) is removed whichever
// path the smoke takes.
let scratch = null;

async function main() {
  const pong = await request("engine.ping");
  if (pong?.pong !== true) throw new Error("engine.ping did not return {pong:true}");

  const raster = await request("job.start", {
    jobId: uuid(1),
    toolId: "pdfToImages",
    input: { filePath: fixture, format: "png", dpi: 72 },
  });
  for (const p of raster.outputPaths ?? []) {
    if (readFileSync(p).subarray(0, 4).toString("hex") !== "89504e47") {
      throw new Error("bad PNG magic: " + p);
    }
    if (!statSync(p).size) throw new Error("empty output: " + p);
  }
  if (!raster.outputPaths?.length) throw new Error("no raster output paths");

  // OCR: proves the staged tesseract.js (external, with its worker script and
  // tesseract.js-core wasm under node_modules) and the staged ocr-data/ both
  // resolve from the release spawn cwd. A missing either surfaces as a typed
  // error instead of producing output.
  const ocr = await request("job.start", {
    jobId: uuid(4),
    toolId: "ocr",
    input: { filePath: fixture, dpi: 72, searchableOutput: false },
  });
  if (!ocr.outputPaths?.length) throw new Error("no OCR output paths");
  for (const p of ocr.outputPaths) {
    if (!p.endsWith(".txt")) throw new Error("OCR output is not a .txt: " + p);
    // A blank fixture OCRs to a valid empty .txt, so existence is the check.
    if (!statSync(p, { throwIfNoEntry: false })?.isFile()) {
      throw new Error("missing OCR output: " + p);
    }
  }

  // qpdf-backed roundtrip: protect with a user password, then unlock it. This
  // proves the staged qpdf (exe + DLLs under deps/qpdf/) resolves from the
  // release spawn cwd; a lone exe would crash before writing the output.
  const source = await PDFDocument.load(readFileSync(fixture));
  const protectedResult = await request("job.start", {
    jobId: uuid(2),
    toolId: "protect",
    input: {
      filePath: fixture,
      userPassword: "smoke-user",
      ownerPassword: "smoke-owner",
      allowPrinting: true,
      allowCopying: true,
    },
  });
  const protectedPath = protectedResult.outputPath;
  if (!protectedPath?.endsWith("protected.pdf")) {
    throw new Error("protect did not return protected.pdf: " + protectedPath);
  }
  if (readFileSync(protectedPath).subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("protected output is not a PDF: " + protectedPath);
  }
  const loadProtected = await PDFDocument.load(readFileSync(protectedPath)).then(
    () => true,
    () => false
  );
  if (loadProtected) throw new Error("protected output loaded without a password");

  const unlockedResult = await request("job.start", {
    jobId: uuid(3),
    toolId: "unlock",
    input: { filePath: protectedPath, password: "smoke-user" },
  });
  const unlockedPath = unlockedResult.outputPath;
  if (!unlockedPath?.endsWith("unlocked.pdf")) {
    throw new Error("unlock did not return unlocked.pdf: " + unlockedPath);
  }
  const unlocked = await PDFDocument.load(readFileSync(unlockedPath));
  if (unlocked.getPageCount() !== source.getPageCount()) {
    throw new Error(
      `unlocked page count ${unlocked.getPageCount()} != source ${source.getPageCount()}`
    );
  }

  // Signing stack roundtrip: the stack is bundled into engine.cjs (pure JS, no
  // staging), so this always runs. A self-signed p12 is generated beside the
  // smoke and used to sign the fixture, then validateSignature must report it
  // valid with the signer's subject.
  const p12Path = join(dir, "smoke-signer.p12");
  writeFileSync(p12Path, makeSelfSignedP12("smoke-pass", "PogoPDF Smoke Signer"));
  const signedResult = await request("job.start", {
    jobId: uuid(7),
    toolId: "digitalSign",
    input: {
      filePath: fixture,
      p12Path,
      passphrase: "smoke-pass",
      reason: "Release smoke",
    },
  });
  const signedPath = signedResult.outputPath;
  if (!signedPath?.endsWith("signed.pdf")) {
    throw new Error("digitalSign did not return signed.pdf: " + signedPath);
  }
  if (readFileSync(signedPath).subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("signed output is not a PDF: " + signedPath);
  }
  const validateResult = await request("job.start", {
    jobId: uuid(8),
    toolId: "validateSignature",
    input: { filePath: signedPath },
  });
  if (validateResult.outputPath !== undefined) {
    throw new Error("validateSignature returned a file path instead of a data result");
  }
  if (validateResult.data?.valid !== true) {
    throw new Error("validateSignature did not report the signature valid");
  }
  if (!/CN=PogoPDF Smoke Signer/.test(validateResult.data.signer?.subject ?? "")) {
    throw new Error("unexpected signer subject: " + validateResult.data.signer?.subject);
  }
  rmSync(p12Path, { force: true });

  // Ghostscript-backed PDF/A conversion: proves the STAGED gs/ tree resolves
  // from the release spawn cwd (resolveGswin) and that gswin64c.exe launches
  // with its sibling gsdll64.dll and Resource/ files. A lone exe could not run.
  // Skipped (loudly) when no gs/ was staged.
  let gsSummary = "pdfToPdfA skipped (no staged Ghostscript)";
  if (hasGs) {
    const pdfaResult = await request("job.start", {
      jobId: uuid(9),
      toolId: "pdfToPdfA",
      input: { filePath: fixture, pdfaVersion: "2b" },
    });
    const pdfaPath = pdfaResult.outputPath;
    if (!pdfaPath?.endsWith("pdfa.pdf")) {
      throw new Error("pdfToPdfA did not return pdfa.pdf: " + pdfaPath);
    }
    const pdfaDoc = await PDFDocument.load(readFileSync(pdfaPath));
    if (pdfaDoc.catalog.get(PDFName.of("OutputIntents")) === undefined) {
      throw new Error("pdfToPdfA output has no /OutputIntents entry");
    }
    gsSummary = `pdfToPdfA (${pdfaDoc.getPageCount()} page(s), OutputIntent verified)`;
  }

  // LibreOffice-backed conversion: craft a minimal docx, convert it through the
  // STAGED lo/ tree, then prove the output is a real PDF whose text is
  // extractable. This exercises build-release's trimmed lo/ layout end-to-end:
  // resolveSoffice() finds deps/lo/program/soffice.exe from the release spawn
  // cwd, and soffice.bin plus its DLLs all live under that same program/ dir.
  // The office case is skipped (loudly) when no lo/ was staged.
  let officeSummary = "office skipped (no staged LibreOffice)";
  if (hasSoffice) {
    scratch = mkdtempSync(join(tmpdir(), "pogopdf-smoke-office-"));
    const { makeDocx, unregister } = await loadDocxBuilder();
    let docx;
    try {
      docx = await makeDocx(join(scratch, "smoke.docx"), "Hello Office Smoke");
    } finally {
      if (typeof unregister === "function") unregister();
    }

    const converted = await request("job.start", {
      jobId: uuid(5),
      toolId: "officeToPdf",
      input: { filePath: docx },
    });
    const convertedPath = converted.outputPath;
    if (!convertedPath?.toLowerCase().endsWith(".pdf")) {
      throw new Error("officeToPdf did not return a .pdf: " + convertedPath);
    }
    if (readFileSync(convertedPath).subarray(0, 4).toString("ascii") !== "%PDF") {
      throw new Error("converted office output is not a PDF: " + convertedPath);
    }
    const convertedDoc = await PDFDocument.load(readFileSync(convertedPath));
    if (convertedDoc.getPageCount() < 1) {
      throw new Error("converted office PDF has no pages");
    }

    // Extract the text back through the engine (pdfToText) to prove the
    // document rendered rather than producing a blank page.
    const textResult = await request("job.start", {
      jobId: uuid(6),
      toolId: "pdfToText",
      input: { filePath: convertedPath },
    });
    const textPath = textResult.outputPath;
    const text = readFileSync(textPath, "utf8");
    if (!text.includes("Hello Office Smoke")) {
      throw new Error("converted office PDF text did not contain the fixture paragraph");
    }
    officeSummary = `office docx conversion (${convertedDoc.getPageCount()} page(s), text verified)`;
  }

  if (err.trim()) throw new Error("stderr not clean: " + err.trim());
  console.log(
    `PASS: ping + pdfToImages (${raster.outputPaths.length} page(s)) + ocr ` +
      `(${ocr.outputPaths.length} txt) + protect/unlock ` +
      `roundtrip (${unlocked.getPageCount()} page(s)) + sign/validate ` +
      `roundtrip (${validateResult.data.signer.subject}) + ${gsSummary} + ` +
      `${officeSummary} via ${depsName}`
  );
}

main().then(
  () => {
    clearTimeout(timer);
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    child.kill();
    process.exit(0);
  },
  (e) => {
    clearTimeout(timer);
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    console.error("FAIL\n" + (e?.message ?? e) + (out || err ? "\n" + out + "\n" + err : ""));
    child.kill();
    process.exit(1);
  }
);
