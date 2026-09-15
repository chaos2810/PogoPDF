import type { ZodType } from "zod";
import type { RpcCtx } from "../rpc/dispatcher";
import { registerMergeTool } from "./merge/register";

export type ToolEntry = {
  schema: ZodType;
  run: (input: unknown, ctx: RpcCtx, outDir: string) => Promise<string>;
};

export type ToolRegistry = Map<string, ToolEntry>;

export function registerTools(tools: ToolRegistry) {
  registerMergeTool(tools);
}
