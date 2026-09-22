import { EditTextInputSchema, TOOL_IDS } from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runEditText } from "./edittext";

export function registerTextEditTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.editText, {
    schema: EditTextInputSchema,
    run: runEditText,
  });
}
