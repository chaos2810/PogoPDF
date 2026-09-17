import { TOOL_IDS } from "@pogopdf/contracts";

export type Category = "organize" | "convertTo" | "convertFrom" | "edit" | "secure" | "utility";

export type ToolMeta = {
  id: string;
  titleKey: string;
  descKey: string;
  category: Category;
  icon: string; // lucide icon name
};

export const registry: ToolMeta[] = [
  { id: TOOL_IDS.merge, titleKey: "tool.merge.title", descKey: "tool.merge.desc", category: "organize", icon: "Combine" },
  { id: TOOL_IDS.split, titleKey: "tool.split.title", descKey: "tool.split.desc", category: "organize", icon: "Scissors" },
  { id: TOOL_IDS.extractPages, titleKey: "tool.extractPages.title", descKey: "tool.extractPages.desc", category: "organize", icon: "FileOutput" },
  { id: TOOL_IDS.deletePages, titleKey: "tool.deletePages.title", descKey: "tool.deletePages.desc", category: "organize", icon: "Trash2" },
  { id: TOOL_IDS.organize, titleKey: "tool.organize.title", descKey: "tool.organize.desc", category: "organize", icon: "LayoutGrid" },
  { id: TOOL_IDS.rotate, titleKey: "tool.rotate.title", descKey: "tool.rotate.desc", category: "organize", icon: "RotateCw" },
  { id: TOOL_IDS.rotateCustom, titleKey: "tool.rotateCustom.title", descKey: "tool.rotateCustom.desc", category: "organize", icon: "Compass" },
  { id: TOOL_IDS.reverse, titleKey: "tool.reverse.title", descKey: "tool.reverse.desc", category: "organize", icon: "ArrowLeftRight" },
  { id: TOOL_IDS.addBlankPage, titleKey: "tool.addBlankPage.title", descKey: "tool.addBlankPage.desc", category: "organize", icon: "FilePlus2" },
  { id: TOOL_IDS.nup, titleKey: "tool.nup.title", descKey: "tool.nup.desc", category: "organize", icon: "Grid2x2" },
  { id: TOOL_IDS.booklet, titleKey: "tool.booklet.title", descKey: "tool.booklet.desc", category: "organize", icon: "BookOpen" },
  { id: TOOL_IDS.dividePages, titleKey: "tool.dividePages.title", descKey: "tool.dividePages.desc", category: "organize", icon: "Columns2" },
  { id: TOOL_IDS.combineSinglePage, titleKey: "tool.combineSinglePage.title", descKey: "tool.combineSinglePage.desc", category: "organize", icon: "StretchVertical" },
  { id: TOOL_IDS.alternateMix, titleKey: "tool.alternateMix.title", descKey: "tool.alternateMix.desc", category: "organize", icon: "Shuffle" },
  { id: TOOL_IDS.duplexCollate, titleKey: "tool.duplexCollate.title", descKey: "tool.duplexCollate.desc", category: "organize", icon: "FileStack" },
  { id: TOOL_IDS.pdfToImages, titleKey: "tool.pdfToImages.title", descKey: "tool.pdfToImages.desc", category: "convertFrom", icon: "FileImage" },
  { id: TOOL_IDS.pdfToText, titleKey: "tool.pdfToText.title", descKey: "tool.pdfToText.desc", category: "convertFrom", icon: "FileText" },
  { id: TOOL_IDS.pdfToSvg, titleKey: "tool.pdfToSvg.title", descKey: "tool.pdfToSvg.desc", category: "convertFrom", icon: "Frame" },
  { id: TOOL_IDS.pdfToCbz, titleKey: "tool.pdfToCbz.title", descKey: "tool.pdfToCbz.desc", category: "convertFrom", icon: "BookImage" },
  { id: TOOL_IDS.pdfToGreyscale, titleKey: "tool.pdfToGreyscale.title", descKey: "tool.pdfToGreyscale.desc", category: "convertFrom", icon: "Contrast" },
  { id: TOOL_IDS.extractImages, titleKey: "tool.extractImages.title", descKey: "tool.extractImages.desc", category: "convertFrom", icon: "ImagePlus" },
  { id: TOOL_IDS.viewMetadata, titleKey: "tool.viewMetadata.title", descKey: "tool.viewMetadata.desc", category: "utility", icon: "Info" },
  { id: TOOL_IDS.pageDimensions, titleKey: "tool.pageDimensions.title", descKey: "tool.pageDimensions.desc", category: "utility", icon: "Ruler" },
  { id: TOOL_IDS.fixPageSize, titleKey: "tool.fixPageSize.title", descKey: "tool.fixPageSize.desc", category: "utility", icon: "Scaling" },
  { id: TOOL_IDS.imagesToPdf, titleKey: "tool.imagesToPdf.title", descKey: "tool.imagesToPdf.desc", category: "convertTo", icon: "Images" },
  { id: TOOL_IDS.textToPdf, titleKey: "tool.textToPdf.title", descKey: "tool.textToPdf.desc", category: "convertTo", icon: "FileText" },
  { id: TOOL_IDS.markdownToPdf, titleKey: "tool.markdownToPdf.title", descKey: "tool.markdownToPdf.desc", category: "convertTo", icon: "FileCode2" },
  { id: TOOL_IDS.csvToPdf, titleKey: "tool.csvToPdf.title", descKey: "tool.csvToPdf.desc", category: "convertTo", icon: "Table" },
  { id: TOOL_IDS.pageNumbers, titleKey: "tool.pageNumbers.title", descKey: "tool.pageNumbers.desc", category: "edit", icon: "Hash" },
  { id: TOOL_IDS.watermark, titleKey: "tool.watermark.title", descKey: "tool.watermark.desc", category: "edit", icon: "Stamp" },
  { id: TOOL_IDS.crop, titleKey: "tool.crop.title", descKey: "tool.crop.desc", category: "edit", icon: "Crop" },
  { id: TOOL_IDS.headerFooter, titleKey: "tool.headerFooter.title", descKey: "tool.headerFooter.desc", category: "edit", icon: "Rows3" },
  { id: TOOL_IDS.editMetadata, titleKey: "tool.editMetadata.title", descKey: "tool.editMetadata.desc", category: "edit", icon: "FilePen" },
  { id: TOOL_IDS.protect, titleKey: "tool.protect.title", descKey: "tool.protect.desc", category: "secure", icon: "Lock" },
  { id: TOOL_IDS.unlock, titleKey: "tool.unlock.title", descKey: "tool.unlock.desc", category: "secure", icon: "LockOpen" },
  { id: TOOL_IDS.flatten, titleKey: "tool.flatten.title", descKey: "tool.flatten.desc", category: "secure", icon: "Layers" },
  { id: TOOL_IDS.removeMetadata, titleKey: "tool.removeMetadata.title", descKey: "tool.removeMetadata.desc", category: "secure", icon: "Eraser" },
  { id: TOOL_IDS.comparePdfs, titleKey: "tool.comparePdfs.title", descKey: "tool.comparePdfs.desc", category: "utility", icon: "GitCompare" },
  { id: TOOL_IDS.pdfsToZip, titleKey: "tool.pdfsToZip.title", descKey: "tool.pdfsToZip.desc", category: "utility", icon: "Archive" },
  { id: TOOL_IDS.rasterize, titleKey: "tool.rasterize.title", descKey: "tool.rasterize.desc", category: "utility", icon: "Scan" },
  { id: TOOL_IDS.officeToPdf, titleKey: "tool.officeToPdf.title", descKey: "tool.officeToPdf.desc", category: "convertTo", icon: "FileSpreadsheet" },
  { id: TOOL_IDS.ebookToPdf, titleKey: "tool.ebookToPdf.title", descKey: "tool.ebookToPdf.desc", category: "convertTo", icon: "BookOpen" },
  { id: TOOL_IDS.comicToPdf, titleKey: "tool.comicToPdf.title", descKey: "tool.comicToPdf.desc", category: "convertTo", icon: "BookImage" },
  { id: TOOL_IDS.ocr, titleKey: "tool.ocr.title", descKey: "tool.ocr.desc", category: "convertTo", icon: "ScanText" },
  { id: TOOL_IDS.extractTables, titleKey: "tool.extractTables.title", descKey: "tool.extractTables.desc", category: "utility", icon: "Table" },
  { id: TOOL_IDS.pdfToMarkdown, titleKey: "tool.pdfToMarkdown.title", descKey: "tool.pdfToMarkdown.desc", category: "utility", icon: "FileCode2" },
  { id: TOOL_IDS.prepareForAi, titleKey: "tool.prepareForAi.title", descKey: "tool.prepareForAi.desc", category: "utility", icon: "Braces" },
  { id: TOOL_IDS.addAttachments, titleKey: "tool.addAttachments.title", descKey: "tool.addAttachments.desc", category: "utility", icon: "Paperclip" },
  { id: TOOL_IDS.extractAttachments, titleKey: "tool.extractAttachments.title", descKey: "tool.extractAttachments.desc", category: "utility", icon: "FileDown" },
  { id: TOOL_IDS.editAttachments, titleKey: "tool.editAttachments.title", descKey: "tool.editAttachments.desc", category: "utility", icon: "FileMinus" },
  { id: TOOL_IDS.viewBookmarks, titleKey: "tool.viewBookmarks.title", descKey: "tool.viewBookmarks.desc", category: "utility", icon: "Bookmark" },
  { id: TOOL_IDS.editBookmarks, titleKey: "tool.editBookmarks.title", descKey: "tool.editBookmarks.desc", category: "utility", icon: "BookMarked" },
  { id: TOOL_IDS.toc, titleKey: "tool.toc.title", descKey: "tool.toc.desc", category: "utility", icon: "ListOrdered" },
];
