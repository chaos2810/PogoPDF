import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";

export function InvertColorsScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.invertColors}
      acceptMultiple={false}
      ctaKey="tool.invertColors.cta"
      footnoteKey="tool.invertColors.hint"
      buildInput={(files) => ({ filePath: files[0] })}
    />
  );
}
