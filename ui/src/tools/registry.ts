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
];
