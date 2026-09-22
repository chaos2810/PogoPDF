import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";

export function FontOutlineScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.fontOutline}
      acceptMultiple={false}
      ctaKey="tool.fontOutline.cta"
      footnoteKey="tool.fontOutline.hint"
      buildInput={(files) => ({ filePath: files[0] })}
    />
  );
}
