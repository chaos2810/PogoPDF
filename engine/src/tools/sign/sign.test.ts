import { describe, it, expect, beforeAll } from "vitest";
import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as forge from "node-forge";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { PDFDocument } from "pdf-lib";
import { fixtureDir, makePdf } from "../../testing/fixtures";
import { registerTools } from "../registry";
import { runDigitalSign } from "./sign";
import { runValidateSignature } from "./validate";
import { runTimestamp } from "./timestamp";
import { extractSignatures, parseSignedData, OID_SIGNATURE_TIMESTAMP_TOKEN } from "./cms";

const ctx = { cancelled: () => false, notifyProgress: () => {} };

function outDir(): string {
  return mkdtempSync(join(tmpdir(), "pogopdf-sign-"));
}

/**
 * A self-signed certificate and matching PKCS#12 bundle, generated in-test with
 * node-forge (no checked-in binary cert). `p12` is the DER bundle; `certPem`
 * exposes the certificate for the trust store.
 */
function makeSelfSigned(
  passphrase: string,
  opts: { commonName?: string; serial?: string; validYears?: number } = {}
): { p12: Buffer; certPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = opts.serial ?? "01";
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + (opts.validYears ?? 1));
  cert.validity.notAfter = notAfter;
  const attrs = [
    { name: "commonName", value: opts.commonName ?? "PogoPDF Test Signer" },
    { name: "organizationName", value: "PogoPDF" },
    { shortName: "C", value: "TW" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: "3des",
  });
  const certPem = forge.pki.certificateToPem(cert);
  return {
    p12: Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary"),
    certPem,
  };
}

/** A TSA certificate and signing key for the mock authority. */
function makeTsa(): { certPkijs: pkijs.Certificate; signKey: Promise<CryptoKey> } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "0a";
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const attrs = [{ name: "commonName", value: "PogoPDF Mock TSA" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certPkijs = pkijs.Certificate.fromBER(
    toArrayBuffer(Buffer.from(forge.pki.pemToDer(forge.pki.certificateToPem(cert)).getBytes(), "binary"))
  );
  const pkcs8Pem = forge.pki.privateKeyInfoToPem(
    forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey))
  );
  const der = Buffer.from(pkcs8Pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
  return { certPkijs, signKey: importRsaKey(der) };
}

async function importRsaKey(der: Buffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(der),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return copy.buffer;
}

/**
 * A mock RFC 3161 authority: it parses each request, records the request shape,
 * and returns a granted TimeStampResp carrying a token it signs with its own key.
 */
async function startMockTsa(tsa: ReturnType<typeof makeTsa>): Promise<{
  server: Server;
  url: string;
  requests: Array<{ contentType: string; version: number; algorithmId: string; digest: Buffer }>;
}> {
  const signKey = await tsa.signKey;
  const requests: Array<{ contentType: string; version: number; algorithmId: string; digest: Buffer }> = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", async () => {
        if (req.method === "POST") {
          const body = Buffer.concat(chunks);
          const parsed = pkijs.TimeStampReq.fromBER(toArrayBuffer(body));
          requests.push({
            contentType: req.headers["content-type"] ?? "",
            version: parsed.version,
            algorithmId: parsed.messageImprint.hashAlgorithm.algorithmId,
            digest: Buffer.from(parsed.messageImprint.hashedMessage.valueBlock.valueHexView),
          });
          const token = await signTstInfo(parsed.messageImprint, tsa.certPkijs, signKey);
          const response = new pkijs.TimeStampResp({
            status: new pkijs.PKIStatusInfo({ status: 0 }),
            timeStampToken: pkijs.ContentInfo.fromBER(toArrayBuffer(token)),
          });
          res.writeHead(200, { "Content-Type": "application/timestamp-reply" });
          res.end(Buffer.from(response.toSchema().toBER(false)));
        } else {
          res.writeHead(405);
          res.end();
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, requests });
    });
  });
}

async function signTstInfo(
  imprint: pkijs.MessageImprint,
  tsaCert: pkijs.Certificate,
  signKey: CryptoKey
): Promise<Buffer> {
  const tstInfo = new pkijs.TSTInfo({
    version: 1,
    policy: "1.2.3.4.1",
    messageImprint: imprint,
    serialNumber: new asn1js.Integer({ value: 7 }),
    genTime: new Date(),
  });
  const sd = new pkijs.SignedData({
    version: 3,
    digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: "1.2.840.113549.1.1.11" })],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: "1.2.840.113549.1.9.16.1.4",
      eContent: new asn1js.OctetString({ valueHex: tstInfo.toSchema().toBER(false) }),
    }),
    certificates: [tsaCert],
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: tsaCert.issuer,
          serialNumber: tsaCert.serialNumber,
        }),
      }),
    ],
  });
  await sd.sign(signKey, 0, "SHA-256", tstInfo.toSchema().toBER(false));
  return Buffer.from(
    new pkijs.ContentInfo({
      contentType: pkijs.ContentInfo.SIGNED_DATA,
      content: sd.toSchema(true),
    })
      .toSchema()
      .toBER(false)
  );
}

/** One page with visible text, so a tamper target exists. */
async function textPdf(path: string): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  page.drawText("Sign me", { x: 40, y: 120, size: 18 });
  writeFileSync(path, await doc.save());
  return path;
}

describe("runDigitalSign", () => {
  let dir: string;
  let cred: ReturnType<typeof makeSelfSigned>;
  let p12Path: string;

  beforeAll(() => {
    dir = fixtureDir("sign-digital");
    cred = makeSelfSigned("secret", { commonName: "PogoPDF Test Signer" });
    p12Path = join(dir, "cert.p12");
    writeFileSync(p12Path, cred.p12);
  });

  it("writes signed.pdf containing a PAdES signature", async () => {
    const src = await textPdf(join(dir, "src.pdf"));
    const out = await runDigitalSign(
      { filePath: src, p12Path, passphrase: "secret", name: "Ada", reason: "Approved", location: "Taipei" },
      ctx,
      outDir()
    );
    expect(out.endsWith("signed.pdf")).toBe(true);
    const bytes = Buffer.from(await (await import("node:fs/promises")).readFile(out));
    const sigs = extractSignatures(bytes);
    expect(sigs).toHaveLength(1);
    const sd = parseSignedData(sigs[0].cms);
    expect(sd).not.toBeNull();
    expect(sd!.signerInfos).toHaveLength(1);
    expect(sd!.encapContentInfo.eContentType).toBe("1.2.840.113549.1.7.1");
  });

  it("maps a wrong passphrase to INVALID_INPUT", async () => {
    const src = await textPdf(join(dir, "wrongpw.pdf"));
    const err = await runDigitalSign(
      { filePath: src, p12Path, passphrase: "wrong" },
      ctx,
      outDir()
    ).catch((e: Error & { code?: number }) => e);
    expect(err).toMatchObject({ code: -32001 });
    expect((err as Error).message).toMatch(/passphrase/i);
  });

  it("maps a missing p12 to CORRUPT_PDF naming the path", async () => {
    const src = await textPdf(join(dir, "nop12.pdf"));
    const missing = join(dir, "does-not-exist.p12");
    const err = await runDigitalSign(
      { filePath: src, p12Path: missing, passphrase: "x" },
      ctx,
      outDir()
    ).catch((e: Error & { code?: number }) => e);
    expect(err).toMatchObject({ code: -32003 });
    expect((err as Error).message).toContain(missing);
  });

  it("maps a missing input PDF to CORRUPT_PDF", async () => {
    await expect(
      runDigitalSign({ filePath: join(dir, "nope.pdf"), p12Path, passphrase: "x" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("maps an encrypted input to ENCRYPTED_PDF", async () => {
    const { encryptedPdfBytes } = await import("../../testing/fixtures");
    const enc = join(dir, "enc.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runDigitalSign({ filePath: enc, p12Path, passphrase: "secret" }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
  });

  it("throws CANCELLED when cancelled before doing any work", async () => {
    const src = await textPdf(join(dir, "cancel.pdf"));
    await expect(
      runDigitalSign(
        { filePath: src, p12Path, passphrase: "secret" },
        { ...ctx, cancelled: () => true },
        outDir()
      )
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("runValidateSignature", () => {
  let dir: string;
  let p12Path: string;
  let trustPath: string;

  beforeAll(() => {
    dir = fixtureDir("sign-validate");
    const cred = makeSelfSigned("secret", { commonName: "PogoPDF Validate Signer" });
    p12Path = join(dir, "cert.p12");
    writeFileSync(p12Path, cred.p12);
    trustPath = join(dir, "trust.pem");
    writeFileSync(trustPath, cred.certPem);
  });

  async function signedFile(name: string): Promise<string> {
    const src = await textPdf(join(dir, `${name}-src.pdf`));
    return runDigitalSign({ filePath: src, p12Path, passphrase: "secret", reason: "Roundtrip" }, ctx, outDir());
  }

  it("round-trips: a signed file validates with signer fields populated", async () => {
    const out = await signedFile("roundtrip");
    const res = await runValidateSignature({ filePath: out }, ctx, outDir());
    expect(res.valid).toBe(true);
    expect(res.signer?.subject).toContain("CN=PogoPDF Validate Signer");
    expect(res.signer?.issuer).toContain("CN=PogoPDF Validate Signer");
    expect(res.signer?.serial).toMatch(/^[0-9A-F]+$/);
    expect(Number.isNaN(Date.parse(res.signer!.notAfter))).toBe(false);
    expect(res.certificates).toBeGreaterThanOrEqual(1);
    expect(res.reason).toBeUndefined();
  });

  it("reports trusted when the trust store holds the signer", async () => {
    const out = await signedFile("trusted");
    const res = await runValidateSignature({ filePath: out, trustStorePath: trustPath }, ctx, outDir());
    expect(res.valid).toBe(true);
    expect(res.trusted).toBe(true);
  });

  it("reports not trusted when the trust store holds a different certificate", async () => {
    const other = makeSelfSigned("other", { commonName: "Other CA" });
    const otherPem = join(dir, "other.pem");
    writeFileSync(otherPem, other.certPem);
    const out = await signedFile("untrusted");
    const res = await runValidateSignature({ filePath: out, trustStorePath: otherPem }, ctx, outDir());
    expect(res.valid).toBe(true);
    expect(res.trusted).toBe(false);
  });

  it("reports valid: false after a byte inside the signed range is changed", async () => {
    const out = await signedFile("tampered");
    const bytes = Buffer.from(await (await import("node:fs/promises")).readFile(out));
    // Flip a byte well inside the first (content) segment of the ByteRange.
    const pos = 20;
    bytes[pos] = bytes[pos] ^ 0xff;
    const tampered = join(dir, "tampered.pdf");
    writeFileSync(tampered, bytes);
    const res = await runValidateSignature({ filePath: tampered }, ctx, outDir());
    expect(res.valid).toBe(false);
    expect(res.reason).toBeTruthy();
  });

  it("reports valid: false for an unsigned document (not an error)", async () => {
    const src = await makePdf(join(dir, "plain.pdf"), 1);
    const res = await runValidateSignature({ filePath: src }, ctx, outDir());
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("No signature found");
    expect(res.certificates).toBe(0);
  });

  it("maps a missing file to CORRUPT_PDF", async () => {
    await expect(
      runValidateSignature({ filePath: join(dir, "nope.pdf") }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("maps a missing trust store to CORRUPT_PDF", async () => {
    const out = await signedFile("trust-missing");
    await expect(
      runValidateSignature(
        { filePath: out, trustStorePath: join(dir, "nope.pem") },
        ctx,
        outDir()
      )
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("maps an encrypted input to ENCRYPTED_PDF", async () => {
    const { encryptedPdfBytes } = await import("../../testing/fixtures");
    const enc = join(dir, "enc.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runValidateSignature({ filePath: enc }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
  });

  it("throws CANCELLED when cancelled before doing any work", async () => {
    const src = await makePdf(join(dir, "cancel.pdf"), 1);
    await expect(
      runValidateSignature({ filePath: src }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("runTimestamp", () => {
  let dir: string;
  let p12Path: string;
  let mock: Awaited<ReturnType<typeof startMockTsa>>;

  beforeAll(async () => {
    dir = fixtureDir("sign-timestamp");
    const cred = makeSelfSigned("secret", { commonName: "PogoPDF Timestamp Signer" });
    p12Path = join(dir, "cert.p12");
    writeFileSync(p12Path, cred.p12);
    mock = await startMockTsa(makeTsa());
  });

  it("timestamps an unsigned document with a standalone doc timestamp", async () => {
    const src = await makePdf(join(dir, "unsigned.pdf"), 1);
    const out = await runTimestamp({ filePath: src, tsaUrl: mock.url }, ctx, outDir());
    expect(out.endsWith("timestamped.pdf")).toBe(true);

    const bytes = Buffer.from(await (await import("node:fs/promises")).readFile(out));
    const sigs = extractSignatures(bytes);
    expect(sigs).toHaveLength(1);
    const sd = parseSignedData(sigs[0].cms);
    expect(sd).not.toBeNull();
    expect(sd!.encapContentInfo.eContentType).toBe("1.2.840.113549.1.9.16.1.4");

    // The token signature must verify against the document bytes it covers.
    const res = await sd!.verify({
      signer: 0,
      data: toArrayBuffer(sigs[0].signedData),
      extendedMode: true,
    });
    expect(res.signatureVerified).toBe(true);

    // validateSignature reports the document timestamp as a valid signature.
    const validated = await runValidateSignature({ filePath: out }, ctx, outDir());
    expect(validated.valid).toBe(true);
  });

  it("asserts the mock TSA saw a well-formed sha-256 request", async () => {
    const before = mock.requests.length;
    const src = await makePdf(join(dir, "shape.pdf"), 1);
    await runTimestamp({ filePath: src, tsaUrl: mock.url }, ctx, outDir());
    expect(mock.requests.length).toBe(before + 1);
    const req = mock.requests[mock.requests.length - 1];
    expect(req.contentType).toBe("application/timestamp-query");
    expect(req.version).toBe(1);
    expect(req.algorithmId).toBe("2.16.840.1.101.3.4.2.1");
    expect(req.digest).toHaveLength(32);
  });

  it("attaches the token as an unsigned attribute to an existing signature", async () => {
    const src = await makePdf(join(dir, "signed-source.pdf"), 1);
    const signed = await runDigitalSign(
      { filePath: src, p12Path, passphrase: "secret", reason: "Timestamp me" },
      ctx,
      outDir()
    );
    const out = await runTimestamp({ filePath: signed, tsaUrl: mock.url }, ctx, outDir());

    const bytes = Buffer.from(await (await import("node:fs/promises")).readFile(out));
    const sigs = extractSignatures(bytes);
    expect(sigs).toHaveLength(1);
    const sd = parseSignedData(sigs[0].cms);
    const attrs = sd!.signerInfos[0].unsignedAttrs?.attributes ?? [];
    const tsAttr = attrs.find((a) => a.type === OID_SIGNATURE_TIMESTAMP_TOKEN);
    expect(tsAttr).toBeDefined();
    // The signature itself must still verify after the attribute is added.
    const res = await runValidateSignature({ filePath: out }, ctx, outDir());
    expect(res.valid).toBe(true);
  });

  it("maps an unreachable TSA to a plain -32000 naming the URL", async () => {
    const src = await makePdf(join(dir, "no-tsa.pdf"), 1);
    // Port 1 is reserved and refuses connections immediately.
    const err = await runTimestamp(
      { filePath: src, tsaUrl: "http://127.0.0.1:1" },
      ctx,
      outDir()
    ).catch((e: Error & { code?: number }) => e);
    expect(err).toMatchObject({ code: -32000 });
    expect((err as Error).message).toContain("127.0.0.1:1");
  });

  it("maps a missing file to CORRUPT_PDF", async () => {
    await expect(
      runTimestamp({ filePath: join(dir, "nope.pdf"), tsaUrl: mock.url }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("maps an encrypted input to ENCRYPTED_PDF", async () => {
    const { encryptedPdfBytes } = await import("../../testing/fixtures");
    const enc = join(dir, "enc.pdf");
    writeFileSync(enc, encryptedPdfBytes());
    await expect(
      runTimestamp({ filePath: enc, tsaUrl: mock.url }, ctx, outDir())
    ).rejects.toMatchObject({ code: -32002 });
  });

  it("throws CANCELLED when cancelled before doing any work", async () => {
    const src = await makePdf(join(dir, "cancel.pdf"), 1);
    await expect(
      runTimestamp({ filePath: src, tsaUrl: mock.url }, { ...ctx, cancelled: () => true }, outDir())
    ).rejects.toMatchObject({ code: -32005 });
  });
});

describe("sign registry", () => {
  it("registers digitalSign, validateSignature and timestamp", () => {
    const tools = new Map();
    registerTools(tools);
    expect(tools.has("digitalSign")).toBe(true);
    expect(tools.has("validateSignature")).toBe(true);
    expect(tools.has("timestamp")).toBe(true);
  });
});
