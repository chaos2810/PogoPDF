import {
  EditorSaveInputSchema,
  FormCreateInputSchema,
  FormFieldsInputSchema,
  FormFillInputSchema,
  SearchInputSchema,
  TOOL_IDS,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runEditorSave } from "./editorSave";
import { runSearch } from "./search";
import { runFormFields } from "./formfields";
import { runFormFill } from "./formfill";
import { runFormCreate } from "./formcreate";

export function registerEditorTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.editorSave, {
    schema: EditorSaveInputSchema,
    run: runEditorSave,
  });
  tools.set(TOOL_IDS.search, {
    schema: SearchInputSchema,
    run: runSearch,
  });
  tools.set(TOOL_IDS.formFields, {
    schema: FormFieldsInputSchema,
    run: runFormFields,
  });
  tools.set(TOOL_IDS.formFill, {
    schema: FormFillInputSchema,
    run: runFormFill,
  });
  tools.set(TOOL_IDS.formCreate, {
    schema: FormCreateInputSchema,
    run: runFormCreate,
  });
}
