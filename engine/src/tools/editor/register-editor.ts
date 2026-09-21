import { EditorSaveInputSchema, TOOL_IDS } from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runEditorSave } from "./editorSave";

export function registerEditorTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.editorSave, {
    schema: EditorSaveInputSchema,
    run: runEditorSave,
  });
}
