import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";

export function ExtractAttachmentsScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.extractAttachments}
      acceptMultiple={false}
      ctaKey="tool.extractAttachments.cta"
      buildInput={(files) => ({ filePath: files[0] })}
    />
  );
}
