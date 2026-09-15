import { useState, type ReactNode } from "react";
import { AppContext, type Theme, type View } from "./store";
import type { Lang } from "@pogopdf/i18n";
import type { Category } from "../tools/registry";

export function LangProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>({ kind: "home" });
  const [theme, setTheme] = useState<Theme>(
    (localStorage.getItem("pogopdf.theme") as Theme) || "system"
  );
  const [lang, setLangState] = useState<Lang>(
    (localStorage.getItem("pogopdf.lang") as Lang) || "en"
  );
  const [categoryFilter, setCategoryFilter] = useState<Category | null>(null);

  const setThemePersist = (t: Theme) => {
    localStorage.setItem("pogopdf.theme", t);
    setTheme(t);
  };
  const setLang = (l: Lang) => {
    localStorage.setItem("pogopdf.lang", l);
    setLangState(l);
  };

  return (
    <AppContext.Provider
      value={{
        view,
        navigate: setView,
        theme,
        setTheme: setThemePersist,
        lang,
        setLang,
        categoryFilter,
        setCategoryFilter,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
