import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";

export function RemoveMetadataScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.removeMetadata}
      acceptMultiple={false}
      ctaKey="tool.removeMetadata.cta"
      footnoteKey="tool.removeMetadata.hint"
      buildInput={(files) => ({ filePath: files[0] })}
    />
  );
}
