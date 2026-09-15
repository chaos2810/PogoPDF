import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "./FileToolScreen";

export function MergeScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.merge}
      acceptMultiple
      ctaKey="tool.merge.cta"
      buildInput={(files) => ({ filePaths: files })}
    />
  );
}
