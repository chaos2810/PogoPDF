import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";

export function DeskewScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.deskew}
      acceptMultiple={false}
      ctaKey="tool.deskew.cta"
      footnoteKey="tool.deskew.hint"
      buildInput={(files) => ({ filePath: files[0] })}
    />
  );
}
