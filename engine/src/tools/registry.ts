import type { ZodType } from "zod";
import type { RpcCtx } from "../rpc/dispatcher";

export type ToolEntry = {
  schema: ZodType;
  run: (input: unknown, ctx: RpcCtx, outDir: string) => Promise<string>;
};

export type ToolRegistry = Map<string, ToolEntry>;

export function registerTools(_tools: ToolRegistry) {
  // tools registered in later tasks
}
