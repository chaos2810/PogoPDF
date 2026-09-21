import {
  BatesNumberInputSchema,
  EditorSaveInputSchema,
  FormCreateInputSchema,
  FormFieldsInputSchema,
  FormFillInputSchema,
  PageLabelsInputSchema,
  RemoveAnnotationsInputSchema,
  RemoveBlankPagesInputSchema,
  RemoveRestrictionsInputSchema,
  SanitizeInputSchema,
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
import { runRemoveRestrictions } from "./restrictions";
import { runSanitize } from "./sanitize";
import { runBates } from "./bates";
import { runPageLabels } from "./pagelabels";

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
  tools.set(TOOL_IDS.removeRestrictions, {
    schema: RemoveRestrictionsInputSchema,
    run: runRemoveRestrictions,
  });
  tools.set(TOOL_IDS.sanitize, {
    schema: SanitizeInputSchema,
    run: runSanitize,
  });
  tools.set(TOOL_IDS.bates, {
    schema: BatesNumberInputSchema,
    run: runBates,
  });
  tools.set(TOOL_IDS.pageLabels, {
    schema: PageLabelsInputSchema,
    run: runPageLabels,
  });
}
