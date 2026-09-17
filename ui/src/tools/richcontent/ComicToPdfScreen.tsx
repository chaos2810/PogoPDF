import { TOOL_IDS } from "@pogopdf/contracts";
import { pickComicFiles } from "../../app/rpc";
import { FileToolScreen } from "../FileToolScreen";

export function ComicToPdfScreen() {
  return (
    <FileToolScreen
      toolId={TOOL_IDS.comicToPdf}
      acceptMultiple={false}
      ctaKey="tool.comicToPdf.cta"
      extensions={["cbz"]}
      pick={() => pickComicFiles(false)}
      footnoteKey="tool.comicToPdf.formatHint"
      dropKeys={{
        multiple: "tool.comicToPdf.drop",
        single: "tool.comicToPdf.dropSingle",
      }}
      buildInput={(files) => ({ filePath: files[0] })}
    />
  );
}
