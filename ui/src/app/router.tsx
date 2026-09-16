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

const TOOL_SCREENS: Record<string, ComponentType> = {
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
