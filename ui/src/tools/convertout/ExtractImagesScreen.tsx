import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";

export function ExtractImagesScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.extractImages}
      acceptMultiple={false}
      ctaKey="tool.extractImages.cta"
      buildInput={(files) => ({ filePath: files[0] })}
    />
  );
}
