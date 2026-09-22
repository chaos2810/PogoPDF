import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DigitalSignInputSchema, TOOL_ERROR_CODES } from "@pogopdf/contracts";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { P12Signer } from "@signpdf/signer-p12";
import signpdfModule from "@signpdf/signpdf";
import { SUBFILTER_ETSI_CADES_DETACHED } from "@signpdf/utils";
import type { RpcCtx } from "../../rpc/dispatcher";
import { assertNotCancelled } from "../organize/organize";
import { corrupt, typedError } from "../errors";
import { loadPdf } from "../pdfdoc";
import { SIGNATURE_PLACEHOLDER_BYTES } from "./cms";

// @signpdf/signpdf is CJS: its module object is the SignPdf instance under
// esbuild's interop, so unwrap a `.default` only when one exists.
const signpdf = (signpdfModule as unknown as { default?: typeof signpdfModule }).default ?? signpdfModule;

/** Map the signer's raw errors to typed engine errors, without echoing secrets. */
function mapSignerError(e: unknown, p12Path: string): Error {
  const message = e instanceof Error ? e.message : String(e);
  if (/mac could not be verified|invalid password|password/i.test(message)) {
    return typedError("Wrong P12 passphrase", TOOL_ERROR_CODES.INVALID_INPUT);
  }
  if (/certificate that matches|keybag|no bags/i.test(message)) {
    return corrupt(`The P12 file has no usable certificate and private key: ${p12Path}`);
  }
  return e instanceof Error
    ? e
    : typedError(`Signing failed: ${message}`, TOOL_ERROR_CODES.CORRUPT_PDF);
}

/**
 * Sign a PDF with an X.509 certificate from a PKCS#12 bundle.
 *
 * The document is loaded with pdf-lib and a PAdES placeholder (SubFilter
 * ETSI.CAdES.detached) is added: a signature dictionary with a fixed /Contents
 * hole and a /ByteRange placeholder. Serializing the document and running it
 * through @signpdf fills that hole with the detached PKCS#7 signature and writes
 * the real /ByteRange, so the signed bytes are exactly the file minus the
 * signature hole.
 *
 * The passphrase transits the RPC boundary like the protect/unlock passwords: it
 * is used in-process and never placed on a command line or written to disk. A
 * missing p12 is CORRUPT_PDF naming it; a wrong passphrase is INVALID_INPUT.
 */
export async function runDigitalSign(
  input: unknown,
  ctx: RpcCtx,
  outDir: string
): Promise<string> {
  const parsed = DigitalSignInputSchema.parse(input);
  assertNotCancelled(ctx);

  const doc = await loadPdf(parsed.filePath);
  if (doc.getPageCount() === 0) {
    throw corrupt(`Cannot sign a PDF with no pages: ${parsed.filePath}`);
  }

  if (!existsSync(parsed.p12Path)) {
    throw corrupt(`P12 certificate not found: ${parsed.p12Path}`);
  }

  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: parsed.reason ?? "",
    contactInfo: "",
    name: parsed.name ?? "",
    location: parsed.location ?? "",
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    signatureLength: SIGNATURE_PLACEHOLDER_BYTES,
  });

  const placeholder = Buffer.from(await doc.save());

  let p12Bytes: Buffer;
  try {
    p12Bytes = readFileSync(parsed.p12Path);
  } catch (e) {
    throw corrupt(
      `Cannot read the P12 file: ${parsed.p12Path} (${e instanceof Error ? e.message : String(e)})`
    );
  }

  const signer = new P12Signer(p12Bytes, { passphrase: parsed.passphrase });
  let signed: Buffer;
  try {
    signed = await signpdf.sign(placeholder, signer, new Date());
  } catch (e) {
    throw mapSignerError(e, parsed.p12Path);
  }

  const outPath = join(outDir, "signed.pdf");
  writeFileSync(outPath, signed);
  return outPath;
}
