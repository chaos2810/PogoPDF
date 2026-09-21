import {
  EditorSaveInputSchema,
  FormCreateInputSchema,
  FormFieldsInputSchema,
  FormFillInputSchema,
  RemoveAnnotationsInputSchema,
  RemoveBlankPagesInputSchema,
  SearchInputSchema,
  SignInputSchema,
  StampInputSchema,
  TOOL_IDS,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runEditorSave } from "./editorSave";
import { runSearch } from "./search";
import { runFormFields } from "./formfields";
import { runFormFill } from "./formfill";
import { runFormCreate } from "./formcreate";
import { runSign } from "./sign";
import { runStamp } from "./stamp";
import { runRemoveAnnotations } from "./removeannotations";
import { runRemoveBlankPages } from "./removeblankpages";

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
  tools.set(TOOL_IDS.sign, {
    schema: SignInputSchema,
    run: runSign,
  });
  tools.set(TOOL_IDS.stamp, {
    schema: StampInputSchema,
    run: runStamp,
  });
  tools.set(TOOL_IDS.removeAnnotations, {
    schema: RemoveAnnotationsInputSchema,
    run: runRemoveAnnotations,
  });
  tools.set(TOOL_IDS.removeBlankPages, {
    schema: RemoveBlankPagesInputSchema,
    run: runRemoveBlankPages,
  });
}
