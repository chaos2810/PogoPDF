import type { ComponentType } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { useApp } from "./store";
import { TopNav } from "../components/TopNav";
import { Home } from "../components/Home";
import { Settings } from "../components/Settings";
import { CommandPalette } from "../components/CommandPalette";
import { MergeScreen } from "../tools/MergeScreen";

const TOOL_SCREENS: Record<string, ComponentType> = {
  [TOOL_IDS.merge]: MergeScreen,
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
