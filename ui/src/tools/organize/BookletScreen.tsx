import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";

export function BookletScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.booklet}
      acceptMultiple={false}
      ctaKey="tool.booklet.cta"
      buildInput={(files) => ({ filePath: files[0] })}
    />
  );
}
