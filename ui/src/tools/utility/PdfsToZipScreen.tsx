import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";

export function PdfsToZipScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.pdfsToZip}
      acceptMultiple
      ctaKey="tool.pdfsToZip.cta"
      buildInput={(files) => ({ filePaths: files })}
    />
  );
}
