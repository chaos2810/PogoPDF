import { TOOL_ERROR_CODES } from "@pogopdf/contracts";

/** Typed error with an RPC error code, surfaced to the UI as {code,message}. */
export function typedError(message: string, code: number): Error {
  return Object.assign(new Error(message), { code });
}

/** Unreadable/corrupt input bytes. */
export function corrupt(message: string): Error {
  return typedError(message, TOOL_ERROR_CODES.CORRUPT_PDF);
}

/** A recognized but unsupported container/format/capability gap. */
export function unsupported(message: string): Error {
  return typedError(message, TOOL_ERROR_CODES.UNSUPPORTED_FORMAT);
}
