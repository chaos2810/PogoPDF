import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";

export function DuplexCollateScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.duplexCollate}
      acceptMultiple={false}
      ctaKey="tool.duplexCollate.cta"
      buildInput={(files) => ({ filePath: files[0] })}
    />
  );
}
