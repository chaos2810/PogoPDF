import { createContext, useContext } from "react";
import type { Lang } from "@pogopdf/i18n";
import type { Category } from "../tools/registry";

export type View = { kind: "home" } | { kind: "tool"; toolId: string } | { kind: "settings" };
export type Theme = "system" | "light" | "dark";

export type AppState = {
  view: View;
  navigate: (v: View) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  categoryFilter: Category | null;
  setCategoryFilter: (c: Category | null) => void;
};

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
}
