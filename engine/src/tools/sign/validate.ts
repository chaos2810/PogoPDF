import { ValidateSignatureInputSchema } from "@pogopdf/contracts";
import type { SignatureData } from "@pogopdf/contracts";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import {
  embeddedCertificates,
  extractSignatures,
  findSignerCertificate,
  formatName,
  formatSerial,
  isTrusted,
  loadTrustStore,
  parseSignedData,
  readPdfBytes,
  toArrayBuffer,
} from "./cms";

export type { SignatureData };

/**
 * Validate the last signature in a PDF.
 *
 * Scope (documented, not an oversight): structural CMS verification. The last
 * signature's PKCS#7 SignedData is parsed, its signer certificate is extracted,
 * the detached signature is checked against the bytes the /ByteRange covers, and
 * the covered bytes are compared with the same region of the current file. A
 * tampered document is valid: false with a reason. When `trustStorePath` is
 * given, the signer's issuer is matched against the store ("chain display", a
 * name-level check). There is NO revocation checking (no CRL or OCSP fetch).
 *
 * An unsigned PDF is not an error: it returns valid: false with
 * reason "No signature found".
 */
export async function runValidateSignature(
  input: unknown,
  ctx: RpcCtx,
  _outDir: string
): Promise<SignatureData> {
  const parsed = ValidateSignatureInputSchema.parse(input);
  assertNotCancelled(ctx);

  const bytes = readPdfBytes(parsed.filePath);
  const signatures = extractSignatures(bytes);
  if (signatures.length === 0) {
    return { valid: false, reason: "No signature found", certificates: 0 };
  }

  const sig = signatures[signatures.length - 1];
  const sd = parseSignedData(sig.cms);
  if (!sd || sd.signerInfos.length === 0) {
    return {
      valid: false,
      reason: "The signature data cannot be parsed as CMS SignedData",
      certificates: 0,
    };
  }

  const certs = embeddedCertificates(sd);
  const signerCert = findSignerCertificate(sd, sd.signerInfos.length - 1);
  const result: SignatureData = { valid: false, certificates: certs.length };

  // The signed bytes must still match the current file: a change inside the
  // ByteRange is a tampered document.
  const coversFile =
    sig.byteRange[0] === 0 &&
    sig.byteRange[0] + sig.byteRange[1] === sig.contentsStart - 1 &&
    sig.byteRange[2] + sig.byteRange[3] === bytes.length;
  if (!coversFile) {
    result.reason = "The document was modified after signing (the signed byte range no longer covers the file)";
  }

  let signatureVerified = false;
  try {
    const res = await sd.verify({
      signer: sd.signerInfos.length - 1,
      data: toArrayBuffer(sig.signedData),
      extendedMode: true,
    });
    signatureVerified = res.signatureVerified === true;
  } catch (e) {
    result.reason = e instanceof Error ? e.message : String(e);
    signatureVerified = false;
  }

  if (signerCert) {
    result.signer = {
      subject: formatName(signerCert.subject),
      issuer: formatName(signerCert.issuer),
      serial: formatSerial(signerCert),
      notAfter: signerCert.notAfter.value.toISOString(),
    };
  }

  if (parsed.trustStorePath) {
    const store = loadTrustStore(parsed.trustStorePath);
    result.trusted = isTrusted(signerCert, store);
  }

  if (coversFile && signatureVerified) {
    result.valid = true;
    delete result.reason;
  } else if (!result.reason) {
    result.reason = "The signature is invalid";
  }

  return result;
}
