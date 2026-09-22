import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { PDFDocument } from "pdf-lib";
import { TimestampInputSchema } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { corrupt, typedError } from "../errors";
import {
  OID_SHA256,
  OID_SIGNATURE_TIMESTAMP_TOKEN,
  OID_TST_INFO,
  SIGNATURE_PLACEHOLDER_BYTES,
  SUBFILTER_ETSI_RFC3161,
  extractSignatures,
  parseSignedData,
  readPdfBytes,
  toArrayBuffer,
} from "./cms";

/** RFC 3161 media types for the request and response bodies. */
const TIMESTAMP_QUERY_CONTENT_TYPE = "application/timestamp-query";
const TIMESTAMP_REPLY_CONTENT_TYPE = "application/timestamp-reply";

/** The TSA request gets this long before it is aborted. */
const TSA_TIMEOUT_MS = 15_000;

/**
 * POST a TimeStampReq to the TSA and return the raw TimeStampResp. This is the
 * engine's only network call; it is opt-in per run and never happens for any
 * other tool.
 *
 * Error mapping decision: an unreachable or slow TSA is NOT an unsupported
 * format, so it is reported as a plain -32000 with a message naming the URL and
 * the transport failure. A malformed reply from a reachable server is also
 * -32000, since the failure is the server's, not the input's.
 */
async function requestTimestamp(tsaUrl: string, request: Buffer): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TSA_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(tsaUrl, {
      method: "POST",
      headers: {
        "Content-Type": TIMESTAMP_QUERY_CONTENT_TYPE,
        Accept: TIMESTAMP_REPLY_CONTENT_TYPE,
      },
      body: toArrayBuffer(request),
      signal: controller.signal,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const reason = controller.signal.aborted ? `timed out after ${TSA_TIMEOUT_MS / 1000}s` : message;
    throw typedError(`Cannot reach the timestamp authority at ${tsaUrl}: ${reason}`, -32000);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw typedError(
      `The timestamp authority at ${tsaUrl} returned HTTP ${response.status}`,
      -32000
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Build the RFC 3161 request over the SHA-256 digest of `data`. */
export function buildTimestampRequest(data: Buffer): { request: Buffer; digest: Buffer } {
  const digest = createHash("sha256").update(data).digest();
  const imprint = new pkijs.MessageImprint({
    hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID_SHA256 }),
    hashedMessage: new asn1js.OctetString({ valueHex: toArrayBuffer(digest) }),
  });
  const req = new pkijs.TimeStampReq({ version: 1, messageImprint: imprint, certReq: true });
  return { request: Buffer.from(req.toSchema().toBER(false)), digest };
}

/**
 * Parse a TimeStampResp into the bare timestamp token (a CMS SignedData with
 * eContentType TSTInfo). Rejects a non-granted status and an imprint that does
 * not cover the request's digest.
 */
export function parseTimestampResponse(
  response: Buffer,
  expectedDigest: Buffer
): { token: Buffer; genTime: Date } {
  let resp: pkijs.TimeStampResp;
  try {
    resp = pkijs.TimeStampResp.fromBER(toArrayBuffer(response));
  } catch (e) {
    throw typedError(
      `The timestamp authority returned a malformed response: ${e instanceof Error ? e.message : String(e)}`,
      -32000
    );
  }
  // status 0 = granted, 1 = grantedWithMods; anything else is a refusal.
  if (resp.status.status !== 0 && resp.status.status !== 1) {
    throw typedError(
      `The timestamp authority refused the request (status ${resp.status.status})`,
      -32000
    );
  }
  if (!resp.timeStampToken) {
    throw typedError("The timestamp authority returned no token", -32000);
  }
  const token = Buffer.from(resp.timeStampToken.toSchema().toBER(false));
  const sd = parseSignedData(token);
  const eContent = sd?.encapContentInfo.eContent;
  if (!sd || sd.encapContentInfo.eContentType !== OID_TST_INFO || !eContent) {
    throw typedError("The timestamp authority token is not a TSTInfo SignedData", -32000);
  }
  const tstInfo = pkijs.TSTInfo.fromBER(eContent.getValue());
  const imprint = Buffer.from(tstInfo.messageImprint.hashedMessage.valueBlock.valueHexView);
  if (!imprint.equals(expectedDigest)) {
    throw typedError("The timestamp token does not cover the requested digest", -32000);
  }
  return { token, genTime: tstInfo.genTime };
}

/**
 * Add the RFC 3161 time-stamp token to an existing signature as the
 * id-aa-signatureTimeStampToken unsigned attribute of its last SignerInfo. The
 * imprint is taken over that SignerInfo's signature value, per CAdES (the caller
 * fetched it before calling this).
 */
function embedTimestampInSignature(pdfBytes: Buffer, token: Buffer): Buffer {
  const signatures = extractSignatures(pdfBytes);
  const sig = signatures[signatures.length - 1];
  const sd = parseSignedData(sig.cms);
  if (!sd || sd.signerInfos.length === 0) {
    throw corrupt("The existing signature cannot be parsed to attach a timestamp");
  }
  const signerInfo = sd.signerInfos[sd.signerInfos.length - 1];

  const tokenCi = pkijs.ContentInfo.fromBER(toArrayBuffer(token));
  const attribute = new pkijs.Attribute({
    type: OID_SIGNATURE_TIMESTAMP_TOKEN,
    values: [tokenCi.toSchema()],
  });
  const existing = signerInfo.unsignedAttrs?.attributes ?? [];
  const remaining = existing.filter((a) => a.type !== OID_SIGNATURE_TIMESTAMP_TOKEN);
  signerInfo.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 1,
    attributes: [...remaining, attribute],
  });

  const newCms = Buffer.from(
    new pkijs.ContentInfo({
      contentType: pkijs.ContentInfo.SIGNED_DATA,
      content: sd.toSchema(true),
    })
      .toSchema()
      .toBER(false)
  );

  // Keep the file length identical so the /ByteRange stays valid: pad the hex
  // back to the hole the original signature occupied.
  const holeLength = sig.contentsEnd - sig.contentsStart;
  let hex = newCms.toString("hex");
  if (hex.length > holeLength) {
    throw typedError(
      "The timestamp token does not fit the signature placeholder; re-sign with a larger placeholder",
      -32000
    );
  }
  hex += "0".repeat(holeLength - hex.length);

  return Buffer.concat([
    pdfBytes.subarray(0, sig.contentsStart),
    Buffer.from(hex, "latin1"),
    pdfBytes.subarray(sig.contentsEnd),
  ]);
}

/**
 * Lay out a standalone document-timestamp placeholder and return the bytes the
 * token must cover plus the function that writes the token into the placeholder.
 * Used when the document has no signature yet. Splitting layout from fetch lets
 * the imprint be computed over exactly the bytes the ByteRange covers.
 */
export async function prepareDocumentTimestamp(
  sourceBytes: Buffer
): Promise<{ signedData: Buffer; applyToken: (token: Buffer) => Buffer }> {
  const pdfDoc = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  if (pdfDoc.getPageCount() === 0) {
    throw corrupt("Cannot timestamp a PDF with no pages");
  }
  pdflibAddPlaceholder({
    pdfDoc,
    reason: "Document timestamp",
    contactInfo: "",
    name: "",
    location: "",
    subFilter: SUBFILTER_ETSI_RFC3161,
    signatureLength: SIGNATURE_PLACEHOLDER_BYTES,
  });
  const placeholder = Buffer.from(await pdfDoc.save());

  const rangePos = placeholder.indexOf("/ByteRange");
  const open = placeholder.indexOf("[", rangePos);
  const close = placeholder.indexOf("]", open);
  const contentsTag = placeholder.indexOf("/Contents", close);
  const hexOpen = placeholder.indexOf("<", contentsTag);
  const hexClose = placeholder.indexOf(">", hexOpen);
  const holeStart = hexOpen + 1;
  const holeLength = hexClose - holeStart;

  // The signed bytes must exclude /Contents but include the real /ByteRange
  // numbers, so replace the placeholder range first (padded to the same length
  // to keep every later offset unchanged). This mirrors @signpdf's order and is
  // why the imprint below is over `laidOut`, not over the raw placeholder.
  // The range starts AT the '<' and resumes after the '>', so the angle brackets
  // are part of the excluded hole (the same convention @signpdf uses).
  const existingRange = placeholder.subarray(rangePos, close + 1).toString("latin1");
  const byteRange = [0, hexOpen, hexClose + 1, placeholder.length - (hexClose + 1)];
  const actualRange = `/ByteRange [${byteRange.join(" ")}]`;
  if (actualRange.length > existingRange.length) {
    throw typedError("The document timestamp byte range does not fit its placeholder", -32000);
  }
  const paddedRange = actualRange + " ".repeat(existingRange.length - actualRange.length);
  const laidOut = Buffer.concat([
    placeholder.subarray(0, rangePos),
    Buffer.from(paddedRange, "latin1"),
    placeholder.subarray(close + 1),
  ]);

  const signedData = Buffer.concat([
    laidOut.subarray(byteRange[0], byteRange[0] + byteRange[1]),
    laidOut.subarray(byteRange[2], byteRange[2] + byteRange[3]),
  ]);

  const applyToken = (token: Buffer): Buffer => {
    let hex = token.toString("hex");
    if (hex.length > holeLength) {
      throw typedError("The document timestamp does not fit the placeholder", -32000);
    }
    hex += "0".repeat(holeLength - hex.length);
    return Buffer.concat([
      laidOut.subarray(0, holeStart),
      Buffer.from(hex, "latin1"),
      laidOut.subarray(hexClose),
    ]);
  };

  return { signedData, applyToken };
}

/**
 * Timestamp a PDF against an RFC 3161 authority.
 *
 * If the document already carries a signature, the token is attached as the
 * last SignerInfo's id-aa-signatureTimeStampToken unsigned attribute (imprint
 * over the signer's signature value). Otherwise a standalone document timestamp
 * is added (imprint over the document's own byte range). This is a NETWORK call
 * to `tsaUrl`; the UI hint states so. No passphrase is involved here.
 */
export async function runTimestamp(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const parsed = TimestampInputSchema.parse(input);
  assertNotCancelled(ctx);

  const bytes = readPdfBytes(parsed.filePath);
  const signatures = extractSignatures(bytes);

  let stamped: Buffer;
  if (signatures.length > 0) {
    const sd = parseSignedData(signatures[signatures.length - 1].cms);
    if (!sd || sd.signerInfos.length === 0) {
      throw corrupt("The existing signature cannot be parsed to attach a timestamp");
    }
    const signerInfo = sd.signerInfos[sd.signerInfos.length - 1];
    const signatureValue = Buffer.from(signerInfo.signature.valueBlock.valueHexView);
    const { request, digest } = buildTimestampRequest(signatureValue);
    assertNotCancelled(ctx);
    const response = await requestTimestamp(parsed.tsaUrl, request);
    const { token } = parseTimestampResponse(response, digest);
    stamped = embedTimestampInSignature(bytes, token);
  } else {
    const prepared = await prepareDocumentTimestamp(bytes);
    const { request, digest } = buildTimestampRequest(prepared.signedData);
    assertNotCancelled(ctx);
    const response = await requestTimestamp(parsed.tsaUrl, request);
    const { token } = parseTimestampResponse(response, digest);
    stamped = prepared.applyToken(token);
  }

  const outPath = join(outDir, "timestamped.pdf");
  writeFileSync(outPath, stamped);
  return outPath;
}
