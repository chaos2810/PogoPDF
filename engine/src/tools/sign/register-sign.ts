import {
  DigitalSignInputSchema,
  TimestampInputSchema,
  TOOL_IDS,
  ValidateSignatureInputSchema,
} from "@pogopdf/contracts";
import type { ToolRegistry } from "../registry";
import { runDigitalSign } from "./sign";
import { runValidateSignature } from "./validate";
import { runTimestamp } from "./timestamp";

export function registerSignTools(tools: ToolRegistry) {
  tools.set(TOOL_IDS.digitalSign, { schema: DigitalSignInputSchema, run: runDigitalSign });
  tools.set(TOOL_IDS.validateSignature, {
    schema: ValidateSignatureInputSchema,
    run: runValidateSignature,
  });
  tools.set(TOOL_IDS.timestamp, { schema: TimestampInputSchema, run: runTimestamp });
}
