import {
  FlattenInputSchema,
  ProtectInputSchema,
  TOOL_IDS,
  UnlockInputSchema,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runProtect } from "./protect";
import { runUnlock } from "./unlock";
import { runFlatten } from "./flatten";

export function registerSecureTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.protect, {
    schema: ProtectInputSchema,
    run: runProtect,
  });
  tools.set(TOOL_IDS.unlock, {
    schema: UnlockInputSchema,
    run: runUnlock,
  });
  tools.set(TOOL_IDS.flatten, {
    schema: FlattenInputSchema,
    run: runFlatten,
  });
}
