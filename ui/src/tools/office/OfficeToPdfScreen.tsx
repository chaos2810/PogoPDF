import { TOOL_IDS } from "@pogopdf/contracts";
import { pickOfficeFiles } from "../../app/rpc";
import { FileToolScreen } from "../FileToolScreen";

// The picker/drag-drop accepts the office + ODF extensions the engine's
// LibreOffice path supports; the hint lists them honestly.
const OFFICE_EXTENSIONS = [
  "docx",
  "doc",
  "odt",
  "rtf",
  "xlsx",
  "xls",
  "ods",
  "pptx",
  "ppt",
  "odp",
  "odg",
];

export function OfficeToPdfScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.officeToPdf}
      acceptMultiple={false}
      ctaKey="tool.officeToPdf.cta"
      extensions={OFFICE_EXTENSIONS}
      pick={() => pickOfficeFiles(false)}
      footnoteKey="tool.officeToPdf.formatHint"
      dropKeys={{
        multiple: "tool.officeToPdf.drop",
        single: "tool.officeToPdf.dropSingle",
      }}
      buildInput={(files) => ({ filePath: files[0] })}
    />
  );
}
