import {
  RpcRequestSchema,
  RpcResponseSchema,
  RpcErrorResponseSchema,
  TOOL_ERROR_CODES,
  PROGRESS_METHOD,
} from "@pogopdf/contracts";
import type { ProgressParams } from "@pogopdf/contracts";
import type { ZodType } from "zod";

export type RpcCtx = {
  cancelled: () => boolean;
  notifyProgress: (p: ProgressParams) => void;
};

type MethodFn = (params: unknown, ctx: RpcCtx) => unknown | Promise<unknown>;

export function createDispatcher(send: (msg: unknown) => void) {
  const methods = new Map<string, { fn: MethodFn; schema?: ZodType }>();

  const sendError = (id: number, code: number, message: string) => {
    send(RpcErrorResponseSchema.parse({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    }));
  };

  return {
    register(method: string, fn: MethodFn, schema?: ZodType) {
      methods.set(method, { fn, schema });
    },

    handle(raw: string) {
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        sendError(-1, -32700, "Parse error");
        return;
      }

      const parsed = RpcRequestSchema.safeParse(msg);
      if (!parsed.success) return; // notifications/invalid are dropped silently
      const { id, method, params } = parsed.data;

      const ctx: RpcCtx = {
        cancelled: () => false,
        notifyProgress: (p) =>
          send({ jsonrpc: "2.0", method: PROGRESS_METHOD, params: p }),
      };

      void (async () => {
        const entry = methods.get(method);
        if (!entry) {
          sendError(id, -32601, "Method not found");
          return;
        }

        let args: unknown = params;
        if (entry.schema) {
          const v = entry.schema.safeParse(params);
          if (!v.success) {
            sendError(id, TOOL_ERROR_CODES.INVALID_INPUT, "Invalid params");
            return;
          }
          args = v.data;
        }

        try {
          const result = await entry.fn(args, ctx);
          send(RpcResponseSchema.parse({ jsonrpc: "2.0", id, result }));
        } catch (e) {
          const code = (e as { code?: number })?.code ?? -32000;
          const message = e instanceof Error ? e.message : "Internal error";
          sendError(id, code, message);
        }
      })();
    },
  };
}
