import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";

export function FlattenScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.flatten}
      acceptMultiple={false}
      ctaKey="tool.flatten.cta"
      footnoteKey="tool.flatten.hint"
      buildInput={(files) => ({ filePath: files[0] })}
    />
  );
}
