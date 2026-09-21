import type { ComponentType } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { useApp } from "./store";
import { TopNav } from "../components/TopNav";
import { Home } from "../components/Home";
import { Settings } from "../components/Settings";
import { CommandPalette } from "../components/CommandPalette";
import { MergeScreen } from "../tools/MergeScreen";
import { SplitScreen } from "../tools/organize/SplitScreen";
import { ExtractPagesScreen } from "../tools/organize/ExtractPagesScreen";
import { DeletePagesScreen } from "../tools/organize/DeletePagesScreen";
import { OrganizeGridScreen } from "../tools/organize/OrganizeGridScreen";
import { RotateScreen } from "../tools/organize/RotateScreen";
import { RotateCustomScreen } from "../tools/organize/RotateCustomScreen";
import { ReverseScreen } from "../tools/organize/ReverseScreen";
import { AddBlankPageScreen } from "../tools/organize/AddBlankPageScreen";
import { NupScreen } from "../tools/organize/NupScreen";
import { BookletScreen } from "../tools/organize/BookletScreen";
import { DividePagesScreen } from "../tools/organize/DividePagesScreen";
import { CombineSinglePageScreen } from "../tools/organize/CombineSinglePageScreen";
import { AlternateMixScreen } from "../tools/organize/AlternateMixScreen";
import { DuplexCollateScreen } from "../tools/organize/DuplexCollateScreen";
import { PdfToImagesScreen } from "../tools/convertout/PdfToImagesScreen";
import { PdfToTextScreen } from "../tools/convertout/PdfToTextScreen";
import { PdfToSvgScreen } from "../tools/convertout/PdfToSvgScreen";
import { PdfToCbzScreen } from "../tools/convertout/PdfToCbzScreen";
import { PdfToGreyscaleScreen } from "../tools/convertout/PdfToGreyscaleScreen";
import { ExtractImagesScreen } from "../tools/convertout/ExtractImagesScreen";
import { ViewMetadataScreen } from "../tools/convertout/ViewMetadataScreen";
import { PageDimensionsScreen } from "../tools/convertout/PageDimensionsScreen";
import { FixPageSizeScreen } from "../tools/convertout/FixPageSizeScreen";
import { ImagesToPdfScreen } from "../tools/convertin/ImagesToPdfScreen";
import { TextToPdfScreen } from "../tools/convertin/TextToPdfScreen";
import { MarkdownToPdfScreen } from "../tools/convertin/MarkdownToPdfScreen";
import { CsvToPdfScreen } from "../tools/convertin/CsvToPdfScreen";
import { PageNumbersScreen } from "../tools/edit/PageNumbersScreen";
import { WatermarkScreen } from "../tools/edit/WatermarkScreen";
import { CropScreen } from "../tools/edit/CropScreen";
import { HeaderFooterScreen } from "../tools/edit/HeaderFooterScreen";
import { EditMetadataScreen } from "../tools/edit/EditMetadataScreen";
import { ProtectScreen } from "../tools/secure/ProtectScreen";
import { UnlockScreen } from "../tools/secure/UnlockScreen";
import { FlattenScreen } from "../tools/secure/FlattenScreen";
import { RemoveMetadataScreen } from "../tools/secure/RemoveMetadataScreen";
import { CompareScreen } from "../tools/utility/CompareScreen";
import { PdfsToZipScreen } from "../tools/utility/PdfsToZipScreen";
import { RasterizeScreen } from "../tools/utility/RasterizeScreen";
import { OfficeToPdfScreen } from "../tools/office/OfficeToPdfScreen";
import { EbookToPdfScreen } from "../tools/richcontent/EbookToPdfScreen";
import { ComicToPdfScreen } from "../tools/richcontent/ComicToPdfScreen";
import { OcrScreen } from "../tools/richcontent/OcrScreen";
import { ExtractTablesScreen } from "../tools/richcontent/ExtractTablesScreen";
import { PdfToMarkdownScreen } from "../tools/richcontent/PdfToMarkdownScreen";
import { PrepareForAiScreen } from "../tools/richcontent/PrepareForAiScreen";
import { AddAttachmentsScreen } from "../tools/richcontent/AddAttachmentsScreen";
import { ExtractAttachmentsScreen } from "../tools/richcontent/ExtractAttachmentsScreen";
import { EditAttachmentsScreen } from "../tools/richcontent/EditAttachmentsScreen";
import { ViewBookmarksScreen } from "../tools/richcontent/ViewBookmarksScreen";
import { EditBookmarksScreen } from "../tools/richcontent/EditBookmarksScreen";
import { TocScreen } from "../tools/richcontent/TocScreen";
import { EditorScreen } from "../tools/editor/EditorScreen";

export const TOOL_SCREENS: Record<string, ComponentType> = {
  [TOOL_IDS.merge]: MergeScreen,
  [TOOL_IDS.split]: SplitScreen,
  [TOOL_IDS.extractPages]: ExtractPagesScreen,
  [TOOL_IDS.deletePages]: DeletePagesScreen,
  [TOOL_IDS.organize]: OrganizeGridScreen,
  [TOOL_IDS.rotate]: RotateScreen,
  [TOOL_IDS.rotateCustom]: RotateCustomScreen,
  [TOOL_IDS.reverse]: ReverseScreen,
  [TOOL_IDS.addBlankPage]: AddBlankPageScreen,
  [TOOL_IDS.nup]: NupScreen,
  [TOOL_IDS.booklet]: BookletScreen,
  [TOOL_IDS.dividePages]: DividePagesScreen,
  [TOOL_IDS.combineSinglePage]: CombineSinglePageScreen,
  [TOOL_IDS.alternateMix]: AlternateMixScreen,
  [TOOL_IDS.duplexCollate]: DuplexCollateScreen,
  [TOOL_IDS.pdfToImages]: PdfToImagesScreen,
  [TOOL_IDS.pdfToText]: PdfToTextScreen,
  [TOOL_IDS.pdfToSvg]: PdfToSvgScreen,
  [TOOL_IDS.pdfToCbz]: PdfToCbzScreen,
  [TOOL_IDS.pdfToGreyscale]: PdfToGreyscaleScreen,
  [TOOL_IDS.extractImages]: ExtractImagesScreen,
  [TOOL_IDS.viewMetadata]: ViewMetadataScreen,
  [TOOL_IDS.pageDimensions]: PageDimensionsScreen,
  [TOOL_IDS.fixPageSize]: FixPageSizeScreen,
  [TOOL_IDS.imagesToPdf]: ImagesToPdfScreen,
  [TOOL_IDS.textToPdf]: TextToPdfScreen,
  [TOOL_IDS.markdownToPdf]: MarkdownToPdfScreen,
  [TOOL_IDS.csvToPdf]: CsvToPdfScreen,
  [TOOL_IDS.pageNumbers]: PageNumbersScreen,
  [TOOL_IDS.watermark]: WatermarkScreen,
  [TOOL_IDS.crop]: CropScreen,
  [TOOL_IDS.headerFooter]: HeaderFooterScreen,
  [TOOL_IDS.editMetadata]: EditMetadataScreen,
  [TOOL_IDS.protect]: ProtectScreen,
  [TOOL_IDS.unlock]: UnlockScreen,
  [TOOL_IDS.flatten]: FlattenScreen,
  [TOOL_IDS.removeMetadata]: RemoveMetadataScreen,
  [TOOL_IDS.comparePdfs]: CompareScreen,
  [TOOL_IDS.pdfsToZip]: PdfsToZipScreen,
  [TOOL_IDS.rasterize]: RasterizeScreen,
  [TOOL_IDS.officeToPdf]: OfficeToPdfScreen,
  [TOOL_IDS.ebookToPdf]: EbookToPdfScreen,
  [TOOL_IDS.comicToPdf]: ComicToPdfScreen,
  [TOOL_IDS.ocr]: OcrScreen,
  [TOOL_IDS.extractTables]: ExtractTablesScreen,
  [TOOL_IDS.pdfToMarkdown]: PdfToMarkdownScreen,
  [TOOL_IDS.prepareForAi]: PrepareForAiScreen,
  [TOOL_IDS.addAttachments]: AddAttachmentsScreen,
  [TOOL_IDS.extractAttachments]: ExtractAttachmentsScreen,
  [TOOL_IDS.editAttachments]: EditAttachmentsScreen,
  [TOOL_IDS.viewBookmarks]: ViewBookmarksScreen,
  [TOOL_IDS.editBookmarks]: EditBookmarksScreen,
  [TOOL_IDS.toc]: TocScreen,
  [TOOL_IDS.editorSave]: EditorScreen,
};

export function Router() {
  const { view } = useApp();
  const ToolScreen = view.kind === "tool" ? TOOL_SCREENS[view.toolId] : undefined;
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <TopNav />
      {view.kind === "home" && <Home />}
      {view.kind === "tool" && ToolScreen && <ToolScreen />}
      {view.kind === "settings" && <Settings />}
      <CommandPalette />
    </div>
  );
}
