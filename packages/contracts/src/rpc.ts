import { z } from "zod";

export const RpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number(),
  method: z.string(),
  params: z.unknown().optional(),
});

export const RpcNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.unknown().optional(),
});

export const RpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number(),
  result: z.unknown(),
});

export const RpcErrorResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
});

export type RpcRequest = z.infer<typeof RpcRequestSchema>;
export type RpcNotification = z.infer<typeof RpcNotificationSchema>;
export type RpcResponse = z.infer<typeof RpcResponseSchema>;
export type RpcError = z.infer<typeof RpcErrorResponseSchema>;

export const TOOL_ERROR_CODES = {
  INVALID_INPUT: -32001,
  ENCRYPTED_PDF: -32002,
  CORRUPT_PDF: -32003,
  OUT_OF_MEMORY: -32004,
  CANCELLED: -32005,
  UNSUPPORTED_FORMAT: -32006,
} as const;

export const PROGRESS_METHOD = "progress";
