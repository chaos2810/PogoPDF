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
];
