import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";

export function ReverseScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.reverse}
      acceptMultiple={false}
      ctaKey="tool.reverse.cta"
      buildInput={(files) => ({ filePath: files[0] })}
    />
  );
}
