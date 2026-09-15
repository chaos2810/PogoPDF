import { useApp } from "./store";
import { TopNav } from "../components/TopNav";
import { Home } from "../components/Home";
import { Settings } from "../components/Settings";
import { CommandPalette } from "../components/CommandPalette";
import { MergeScreen } from "../tools/MergeScreen";

export function Router() {
  const { view } = useApp();
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <TopNav />
      {view.kind === "home" && <Home />}
      {view.kind === "tool" && view.toolId === "merge" && <MergeScreen />}
      {view.kind === "settings" && <Settings />}
      <CommandPalette />
    </div>
  );
}
