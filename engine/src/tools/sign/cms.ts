import { existsSync, readFileSync } from "node:fs";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { corrupt, typedError } from "../errors";

/**
 * Bytes reserved for the CMS signature inside the placeholder. A single 2048-bit
 * certificate plus signed attributes is about 1.3 KB; a later RFC 3161 timestamp
 * token adds about 1.2 KB to the same CMS. 16 KB (32 KB of hex) leaves generous
 * headroom for a small certificate chain.
 */
export const SIGNATURE_PLACEHOLDER_BYTES = 16384;

/** The id-aa-signatureTimeStampToken attribute (RFC 3161 section 2.4.2). */
export const OID_SIGNATURE_TIMESTAMP_TOKEN = "1.2.840.113549.1.9.16.2.14";
/** id-eContentType-TSTInfo, the CMS encapsulated type of a timestamp token. */
export const OID_TST_INFO = "1.2.840.113549.1.9.16.1.4";
/** SHA-256, the message-imprint algorithm the engine uses. */
export const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
/**
 * The PDF signature SubFilter for an RFC 3161 document timestamp
 * (ISO 32000-2, table 256). @signpdf/utils 3.3.0 does not export it.
 */
export const SUBFILTER_ETSI_RFC3161 = "ETSI.RFC3161";

/** Copy a Node Buffer into a standalone ArrayBuffer for WebCrypto/asn1js. */
export function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return copy.buffer;
}

/**
 * A signature region found by scanning the raw PDF: the /ByteRange, the decoded
 * CMS from the /Contents hex string, and the bytes the signature covers.
 */
export type ExtractedSignature = {
  byteRange: [number, number, number, number];
  cms: Buffer;
  signedData: Buffer;
  /** Offsets of the hex digits (exclusive of the angle brackets) in the raw PDF. */
  contentsStart: number;
  contentsEnd: number;
};

/**
 * Find every signature region in a raw PDF buffer. This is a structural scan
 * (no full PDF parse): each /ByteRange is read, the /Contents hex string that
 * follows it is decoded, and the bytes it covers are concatenated. A placeholder
 * that has not been signed (all-zero contents) is skipped.
 */
export function extractSignatures(pdf: Buffer): ExtractedSignature[] {
  const out: ExtractedSignature[] = [];
  let offset = 0;
  while (offset < pdf.length) {
    const pos = pdf.indexOf("/ByteRange", offset);
    if (pos === -1) break;
    const open = pdf.indexOf("[", pos);
    const close = pdf.indexOf("]", open);
    if (open === -1 || close === -1) break;
    offset = close + 1;

    const nums = pdf
      .subarray(open + 1, close)
      .toString("latin1")
      .trim()
      .split(/\s+/)
      .map(Number);
    if (nums.length !== 4 || nums.some((n) => !Number.isInteger(n) || n < 0)) continue;
    const [a, b, c, d] = nums;

    const contentsTag = pdf.indexOf("/Contents", close);
    if (contentsTag === -1) continue;
    const hexOpen = pdf.indexOf("<", contentsTag);
    const hexClose = pdf.indexOf(">", hexOpen);
    if (hexOpen === -1 || hexClose === -1) continue;

    const hex = pdf.subarray(hexOpen + 1, hexClose).toString("latin1").replace(/\s+/g, "");
    // An unsigned placeholder is all zero bytes; skip it.
    if (!hex.replace(/(?:00)+$/, "")) continue;
    const raw = Buffer.from(hex, "hex");
    if (raw.length < 4) continue;
    // signpdf pads the CMS with trailing zero bytes; the DER length header marks
    // the real end, so parse and cut rather than string-trimming. A blob that
    // cannot be parsed is not a signature region.
    let cms: Buffer;
    try {
      const parsed = asn1js.fromBER(toArrayBuffer(raw));
      cms = parsed.offset === -1 ? raw : raw.subarray(0, parsed.offset);
    } catch {
      continue;
    }

    out.push({
      byteRange: [a, b, c, d],
      cms,
      signedData: Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]),
      contentsStart: hexOpen + 1,
      contentsEnd: hexClose,
    });
  }
  return out;
}

/** Read the raw bytes of a plain (non-encrypted) PDF, with typed errors. */
export function readPdfBytes(filePath: string): Buffer {
  if (!existsSync(filePath)) throw corrupt(`File not found: ${filePath}`);
  const bytes = readFileSync(filePath);
  if (
    bytes.length < 5 ||
    bytes.subarray(0, 5).toString("latin1") !== "%PDF-"
  ) {
    throw corrupt(`Not a PDF file: ${filePath}`);
  }
  if (bytes.includes(Buffer.from("/Encrypt"))) {
    throw typedError(
      `This PDF is encrypted; decrypt it before signing, validating, or timestamping`,
      TOOL_ERROR_CODES.ENCRYPTED_PDF
    );
  }
  return bytes;
}

/** Parse a /Contents CMS blob into SignedData, or null when it is not one. */
export function parseSignedData(cms: Buffer): pkijs.SignedData | null {
  try {
    const ci = pkijs.ContentInfo.fromBER(toArrayBuffer(cms));
    if (ci.contentType !== pkijs.ContentInfo.SIGNED_DATA) return null;
    const sd = new pkijs.SignedData({ schema: ci.content });
    normalizeEncapsulatedContent(sd);
    return sd;
  } catch {
    return null;
  }
}

/**
 * pkijs 3.4.1's EncapsulatedContentInfo wraps a large eContent in a constructed
 * OCTET STRING, then TSTInfo.fromBER reads an empty valueHexView and rejects a
 * valid timestamp token. Collapsing the constructed string back to a primitive
 * one restores the bytes TSTInfo needs. The signature itself is checked against
 * the detached data, so this does not weaken verification.
 */
function normalizeEncapsulatedContent(sd: pkijs.SignedData): void {
  const ec = sd.encapContentInfo?.eContent as asn1js.OctetString | undefined;
  if (
    ec &&
    ec.idBlock.tagClass === 1 &&
    ec.idBlock.tagNumber === 4 &&
    ec.idBlock.isConstructed
  ) {
    sd.encapContentInfo.eContent = new asn1js.OctetString({ valueHex: ec.getValue() });
  }
}

/** The embedded certificates of a SignedData, in order. */
export function embeddedCertificates(sd: pkijs.SignedData): pkijs.Certificate[] {
  return (sd.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
}

const DN_NAMES: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.4": "SN",
  "2.5.4.5": "serialNumber",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.9": "STREET",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.12": "title",
  "1.2.840.113549.1.9.1": "E",
};

/** Render a certificate subject/issuer as "CN=..., O=..." for display. */
export function formatName(name: pkijs.RelativeDistinguishedNames): string {
  return name.typesAndValues
    .map((tv) => {
      const value = tv.value?.valueBlock?.value ?? tv.value?.valueBlock?.toString?.() ?? "";
      const label = DN_NAMES[tv.type] ?? tv.type;
      return `${label}=${String(value)}`;
    })
    .join(", ");
}

/** Serial number as an uppercase hex string, for display. */
export function formatSerial(cert: pkijs.Certificate): string {
  const hex = Buffer.from(cert.serialNumber.valueBlock.valueHexView)
    .toString("hex")
    .replace(/^0+(?=.)/, "");
  return hex.toUpperCase();
}

/**
 * Locate the signer certificate for SignerInfo `index`: match by issuer and
 * serial (IssuerAndSerialNumber), which is what forge/pkijs emit.
 */
export function findSignerCertificate(
  sd: pkijs.SignedData,
  index: number
): pkijs.Certificate | undefined {
  const certs = embeddedCertificates(sd);
  const signerInfo = sd.signerInfos[index];
  if (!signerInfo) return undefined;
  const sid = signerInfo.sid as pkijs.IssuerAndSerialNumber;
  if (sid?.issuer && sid?.serialNumber) {
    return certs.find(
      (c) => c.issuer.isEqual(sid.issuer) && c.serialNumber.isEqual(sid.serialNumber)
    );
  }
  return certs[0];
}

/** Parse the certificates out of a PEM trust store (or a single DER .cer). */
export function loadTrustStore(filePath: string): pkijs.Certificate[] {
  if (!existsSync(filePath)) throw corrupt(`Trust store not found: ${filePath}`);
  const text = readFileSync(filePath).toString("latin1");
  const certs: pkijs.Certificate[] = [];
  const re = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const der = Buffer.from(match[1].replace(/\s+/g, ""), "base64");
    try {
      certs.push(pkijs.Certificate.fromBER(toArrayBuffer(der)));
    } catch {
      throw corrupt(`Trust store contains a certificate that cannot be parsed: ${filePath}`);
    }
  }
  if (certs.length === 0) {
    // A bare DER certificate file (no PEM armor).
    try {
      certs.push(pkijs.Certificate.fromBER(toArrayBuffer(readFileSync(filePath))));
    } catch {
      throw corrupt(
        `Trust store has no PEM certificates; supply a PEM chain (.pem): ${filePath}`
      );
    }
  }
  return certs;
}

/**
 * Whether the signer chains to the trust store. v1 is a name-level check (the
 * plan's "chain display" scope): a store certificate is trusted if its subject
 * matches the signer's issuer, or if it is the signer's own certificate. This is
 * NOT cryptographic path validation and there is no revocation checking.
 */
export function isTrusted(
  signerCert: pkijs.Certificate | undefined,
  store: pkijs.Certificate[]
): boolean {
  if (!signerCert) return false;
  return store.some(
    (c) =>
      c.subject.isEqual(signerCert.issuer) ||
      (c.subject.isEqual(signerCert.subject) && c.serialNumber.isEqual(signerCert.serialNumber))
  );
}
