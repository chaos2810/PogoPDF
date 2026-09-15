import type { ZodType } from "zod";
import type { RpcCtx } from "../rpc/dispatcher";
import { registerMergeTool } from "./merge/register";
import { registerSimpleOrganizeTools } from "./organize/register-simple";
import { registerBatchOrganizeTools } from "./organize/register-batch";

export type ToolEntry = {
  schema: ZodType;
  run: (
    input: unknown,
    ctx: RpcCtx,
    outDir: string
  ) => Promise<string | string[]>;
};

export type ToolRegistry = Map<string, ToolEntry>;

export function registerTools(tools: ToolRegistry) {
  registerMergeTool(tools);
  registerSimpleOrganizeTools(tools);
  registerBatchOrganizeTools(tools);
}
