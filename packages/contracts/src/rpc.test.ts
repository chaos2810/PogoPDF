import { describe, it, expect } from "vitest";
import {
  RpcRequestSchema,
  RpcNotificationSchema,
  RpcErrorResponseSchema,
  TOOL_ERROR_CODES,
} from "./rpc";

describe("RpcRequestSchema", () => {
  it("accepts a valid request", () => {
    const r = RpcRequestSchema.safeParse({
      jsonrpc: "2.0", id: 1, method: "job.start", params: {},
    });
    expect(r.success).toBe(true);
  });
  it("rejects missing id", () => {
    const r = RpcRequestSchema.safeParse({ jsonrpc: "2.0", method: "job.start" });
    expect(r.success).toBe(false);
  });
});

describe("RpcNotificationSchema", () => {
  it("accepts a notification (no id)", () => {
    const n = RpcNotificationSchema.safeParse({ jsonrpc: "2.0", method: "progress" });
    expect(n.success).toBe(true);
  });
  it("rejects a payload carrying an id (requests are not notifications)", () => {
    const n = RpcNotificationSchema.safeParse({ jsonrpc: "2.0", id: 1, method: "progress" });
    expect(n.success).toBe(false);
  });
});

describe("RpcErrorResponseSchema", () => {
  it("accepts a typed error", () => {
    const e = RpcErrorResponseSchema.safeParse({
      jsonrpc: "2.0", id: 2,
      error: { code: TOOL_ERROR_CODES.ENCRYPTED_PDF, message: "pdf is encrypted" },
    });
    expect(e.success).toBe(true);
  });
});
