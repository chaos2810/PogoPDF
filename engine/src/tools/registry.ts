import type { ZodType } from "zod";
import type { RpcCtx } from "../rpc/dispatcher";
import { registerMergeTool } from "./merge/register";
import { registerSimpleOrganizeTools } from "./organize/register-simple";
import { registerBatchOrganizeTools } from "./organize/register-batch";
import { registerGridOrganizeTools } from "./organize/register-grid";
import { registerConvertRasterTools } from "./convertout/register-convert-raster";
import { registerConvertInfoTools } from "./convertout/register-convert-info";
import { registerConvertMiscTools } from "./convertout/register-convert-misc";
import { registerConvertInTools } from "./convertin/register-convertin";
import { registerOfficeTools } from "./office/register-office";
import { registerRichContentTools } from "./richcontent/register-richcontent";
import { registerEditTools } from "./edit/register-edit";
import { registerSecureTools } from "./secure/register-secure";
import { registerUtilityTools } from "./utility/register-utility";

export type ToolEntry = {
  schema: ZodType;
  run: (
    input: unknown,
    ctx: RpcCtx,
    outDir: string
  ) => Promise<string | string[] | object>;
};

export type ToolRegistry = Map<string, ToolEntry>;

export function registerTools(tools: ToolRegistry) {
  registerMergeTool(tools);
  registerSimpleOrganizeTools(tools);
  registerBatchOrganizeTools(tools);
  registerGridOrganizeTools(tools);
  registerConvertRasterTools(tools);
  registerConvertInfoTools(tools);
  registerConvertMiscTools(tools);
  registerConvertInTools(tools);
  registerOfficeTools(tools);
  registerRichContentTools(tools);
  registerEditTools(tools);
  registerSecureTools(tools);
  registerUtilityTools(tools);
}
